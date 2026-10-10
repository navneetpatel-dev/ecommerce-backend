# Two secrets, split by who owns the values:
#
#  backend-generated : created and rotated by Terraform (DB password, JWT keys,
#                      Redis URL with auth token). Never edit by hand.
#  backend-app       : third-party credentials you paste in (Razorpay, Google,
#                      Sentry …). Terraform only creates it with placeholders and
#                      then ignores its contents.

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "jwt_refresh" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "backend_generated" {
  name                    = "${var.project}/${var.environment}/backend-generated"
  description             = "Terraform-managed backend credentials. Do not edit by hand."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "backend_generated" {
  secret_id = aws_secretsmanager_secret.backend_generated.id
  secret_string = jsonencode({
    DB_PASSWORD        = random_password.db.result
    JWT_SECRET         = random_password.jwt.result
    JWT_REFRESH_SECRET = random_password.jwt_refresh.result
    REDIS_URL          = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
  })
}

resource "aws_secretsmanager_secret" "backend_app" {
  name                    = "${var.project}/${var.environment}/backend-app"
  description             = "Third-party credentials for the backend. Edit values in the console; keys must match backend_app_secret_keys."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "backend_app" {
  secret_id     = aws_secretsmanager_secret.backend_app.id
  secret_string = jsonencode({ for key in var.backend_app_secret_keys : key => "" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

locals {
  generated_secret_keys = ["DB_PASSWORD", "JWT_SECRET", "JWT_REFRESH_SECRET", "REDIS_URL"]

  backend_secrets = concat(
    [for key in local.generated_secret_keys : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.backend_generated.arn}:${key}::"
    }],
    [for key in var.backend_app_secret_keys : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.backend_app.arn}:${key}::"
    }],
  )
}
