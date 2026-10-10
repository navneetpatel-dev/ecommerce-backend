output "alb_dns_name" {
  description = "Point app_domain and api_domain here (CNAME/ALIAS) if DNS is not in Route 53."
  value       = aws_lb.main.dns_name
}

output "app_url" {
  value = "https://${var.app_domain}"
}

output "api_url" {
  value = "https://${var.api_domain}"
}

output "backend_app_secret_name" {
  description = "Paste Razorpay (and other third-party) credentials into this secret."
  value       = aws_secretsmanager_secret.backend_app.name
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

# Copy these into each repository: Settings → Secrets and variables → Actions →
# Variables (repository variables, not environment variables).
output "github_variables_backend" {
  value = {
    API_URL               = "https://${var.api_domain}"
    AWS_REGION            = var.aws_region
    AWS_DEPLOY_ROLE_ARN   = aws_iam_role.github_deploy.arn
    ECR_REPOSITORY        = aws_ecr_repository.backend.name
    ECS_CLUSTER           = aws_ecs_cluster.main.name
    ECS_API_SERVICE       = aws_ecs_service.api.name
    ECS_WORKER_SERVICE    = aws_ecs_service.worker.name
    ECS_MIGRATE_TASK      = aws_ecs_task_definition.migrate.family
    ECS_PRIVATE_SUBNETS   = join(",", aws_subnet.private[*].id)
    ECS_TASK_SECURITY_GRP = aws_security_group.worker.id
  }
}

output "github_variables_web" {
  value = {
    AWS_REGION           = var.aws_region
    AWS_DEPLOY_ROLE_ARN  = aws_iam_role.github_deploy.arn
    ECR_REPOSITORY       = aws_ecr_repository.web.name
    ECS_CLUSTER          = aws_ecs_cluster.main.name
    ECS_WEB_SERVICE      = aws_ecs_service.web.name
    NEXT_PUBLIC_API_URL  = "https://${var.api_domain}"
    NEXT_PUBLIC_SITE_URL = "https://${var.app_domain}"
  }
}
