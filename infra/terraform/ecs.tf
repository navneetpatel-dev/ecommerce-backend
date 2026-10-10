# ECS Fargate: three services from two images.
#
#   api    (backend image, `node dist/src/server.js`)  behind the ALB
#   worker (backend image, `node dist/src/worker.js`)  no inbound traffic
#   web    (web image,     `node server.js`)           behind the ALB
#
# Terraform owns the task definitions' env, secrets and sizing. GitHub Actions
# owns the image: each deploy copies the latest revision, swaps the image, and
# registers a new revision. Services therefore ignore task_definition drift.
# After changing env/secrets here, run the repo's deploy workflow (or push) to
# roll it out.

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name}/backend"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}/web"
  retention_in_days = var.log_retention_days
}

locals {
  # Placeholder until the first deploy pushes a real tag. Tasks fail to pull
  # this image, which is expected until the deploy workflow has run once.
  initial_backend_image = "${aws_ecr_repository.backend.repository_url}:initial"
  initial_web_image     = "${aws_ecr_repository.web.repository_url}:initial"

  backend_env = merge(
    {
      NODE_ENV                    = "production"
      PORT                        = "9000"
      TRUST_PROXY_HOPS            = "1"
      LOG_LEVEL                   = "info"
      START_WORKERS_IN_API        = "false"
      DB_HOST                     = aws_db_instance.main.address
      DB_PORT                     = tostring(aws_db_instance.main.port)
      DB_NAME                     = var.db_name
      DB_USER                     = var.db_username
      DB_SSL                      = "true"
      AWS_REGION                  = var.aws_region
      AWS_USE_DEFAULT_CREDENTIALS = "true"
      S3_BUCKET                   = var.media_bucket_name
      MAIL_DRIVER                 = var.mail_driver
      MAIL_FROM_EMAIL             = var.mail_from_email
      MAIL_FROM_NAME              = var.mail_from_name
      CLIENT_URL                  = "https://${var.app_domain}"
      GOOGLE_CALLBACK_URL         = "https://${var.api_domain}/api/auth/google/callback"
    },
    var.backend_extra_env,
  )

  backend_environment = [for k in sort(keys(local.backend_env)) : { name = k, value = local.backend_env[k] }]

  web_env = merge(
    {
      NODE_ENV = "production"
      PORT     = "3000"
      HOSTNAME = "0.0.0.0"
      # Also baked into the image at build time; set here for server-side reads.
      NEXT_PUBLIC_API_URL  = "https://${var.api_domain}"
      NEXT_PUBLIC_SITE_URL = "https://${var.app_domain}"
    },
    var.web_extra_env,
  )

  web_environment = [for k in sort(keys(local.web_env)) : { name = k, value = local.web_env[k] }]

  network_private = {
    subnets          = aws_subnet.private[*].id
    assign_public_ip = false
  }
}

# ---- Task definitions -------------------------------------------------------------

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name        = "api"
    image       = local.initial_backend_image
    essential   = true
    command     = ["node", "dist/src/server.js"]
    environment = local.backend_environment
    secrets     = local.backend_secrets
    portMappings = [{
      containerPort = 9000
      protocol      = "tcp"
    }]
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:9000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
    stopTimeout = 30
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.backend.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "api"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name        = "worker"
    image       = local.initial_backend_image
    essential   = true
    command     = ["node", "dist/src/worker.js"]
    environment = local.backend_environment
    secrets     = local.backend_secrets
    stopTimeout = 60
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.backend.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

# One-off migration task. The deploy workflow runs it with the new image before
# rolling the API and worker, and fails the deploy if it exits non-zero.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name        = "migrate"
    image       = local.initial_backend_image
    essential   = true
    command     = ["npx", "--no-install", "sequelize-cli", "db:migrate"]
    environment = local.backend_environment
    secrets     = local.backend_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.backend.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.web_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name        = "web"
    image       = local.initial_web_image
    essential   = true
    environment = local.web_environment
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    stopTimeout = 30
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.web.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "web"
      }
    }
  }])
}

# ---- Services ---------------------------------------------------------------------

resource "aws_ecs_service" "api" {
  name                   = "${local.name}-api"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = var.api_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true
  propagate_tags         = "SERVICE"

  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = local.network_private.subnets
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = local.network_private.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 9000
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener_rule.api]
}

resource "aws_ecs_service" "worker" {
  name                   = "${local.name}-worker"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.worker.arn
  desired_count          = var.worker_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true
  propagate_tags         = "SERVICE"

  # Schedulers run inside the worker; never run two during a rollout.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = local.network_private.subnets
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = local.network_private.assign_public_ip
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_ecs_service" "web" {
  name                   = "${local.name}-web"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.web.arn
  desired_count          = var.web_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true
  propagate_tags         = "SERVICE"

  health_check_grace_period_seconds  = 30
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = local.network_private.subnets
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = local.network_private.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener_rule.web]
}
