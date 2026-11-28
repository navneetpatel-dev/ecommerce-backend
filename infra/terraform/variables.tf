# ---- Identity ---------------------------------------------------------------

variable "project" {
  description = "Prefix for every resource name."
  type        = string
  default     = "ecommerce"
}

variable "environment" {
  description = "Environment name; also the GitHub Environment the deploy jobs use."
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "Region for everything. eu-north-1 matches the existing media bucket."
  type        = string
  default     = "eu-north-1"
}

# ---- GitHub ------------------------------------------------------------------

variable "github_owner" {
  description = "GitHub user/org that owns both repositories."
  type        = string
  default     = "navneetpatel-dev"
}

variable "github_backend_repo" {
  type    = string
  default = "ecommerce-backend"
}

variable "github_web_repo" {
  type    = string
  default = "ecommerce-web"
}

variable "create_github_oidc_provider" {
  description = "An AWS account can hold only one GitHub OIDC provider. Set false if it already exists."
  type        = bool
  default     = true
}

# ---- Domains & TLS -----------------------------------------------------------

variable "app_domain" {
  description = "Storefront domain served by the Next.js app, e.g. shop.example.com."
  type        = string
}

variable "api_domain" {
  description = "Backend API domain, e.g. api.shop.example.com. Becomes NEXT_PUBLIC_API_URL."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for both domains. When set, Terraform issues the ACM certificate and creates DNS records. Leave empty to bring your own certificate and DNS."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Existing ACM certificate (same region) covering app_domain and api_domain. Required when route53_zone_id is empty."
  type        = string
  default     = ""
}

# ---- Network -----------------------------------------------------------------

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "single_nat_gateway" {
  description = "One NAT gateway (cheaper) instead of one per AZ (survives an AZ outage)."
  type        = bool
  default     = true
}

# ---- Database & cache ----------------------------------------------------------

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling (GiB)."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_name" {
  type    = string
  default = "ecommerce"
}

variable "db_username" {
  type    = string
  default = "ecommerce"
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

# ---- Media bucket (already exists; not created here) ---------------------------

variable "media_bucket_name" {
  description = "Existing S3 bucket for uploads (see infra/s3/README.md)."
  type        = string
}

variable "manage_media_bucket_cors" {
  description = "Let Terraform own the media bucket's CORS rules (adds app_domain for browser PUT uploads)."
  type        = bool
  default     = true
}

variable "media_bucket_extra_cors_origins" {
  description = "Extra origins allowed to PUT to the media bucket, e.g. local dev."
  type        = list(string)
  default     = ["http://localhost:5173", "http://localhost:3000"]
}

# ---- ECS sizing ----------------------------------------------------------------

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "api_desired_count" {
  description = "Keep at 1 until Socket.IO has a Redis adapter: rooms are per-process today."
  type        = number
  default     = 1
}

variable "worker_cpu" {
  type    = number
  default = 512
}

variable "worker_memory" {
  type    = number
  default = 1024
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "web_cpu" {
  type    = number
  default = 512
}

variable "web_memory" {
  type    = number
  default = 1024
}

variable "web_desired_count" {
  type    = number
  default = 1
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# ---- App configuration ------------------------------------------------------------

variable "smtp_host" {
  description = "SMTP server the backend sends all email through, e.g. smtp.gmail.com. The API does not start without it."
  type        = string

  validation {
    condition     = trimspace(var.smtp_host) != ""
    error_message = "smtp_host is required: SMTP is the only way the backend sends email."
  }
}

variable "smtp_port" {
  description = "587 (STARTTLS) or 465 (TLS). AWS restricts outbound port 25."
  type        = number
  default     = 587
}

variable "smtp_secure" {
  description = "true for TLS from the first byte (port 465); false for STARTTLS (port 587)."
  type        = bool
  default     = false
}

variable "mail_rate_per_minute" {
  description = "Emails each worker queue may send per minute. Keep it low for Gmail."
  type        = number
  default     = 20
}

variable "mail_from_email" {
  type    = string
  default = "noreply@example.com"
}

variable "mail_from_name" {
  type    = string
  default = "Ecommerce"
}

variable "backend_extra_env" {
  description = "Extra plain (non-secret) env vars for the API and worker, e.g. { S3_PUBLIC_BASE_URL = \"https://cdn.example.com\" }."
  type        = map(string)
  default     = {}
}

variable "backend_app_secret_keys" {
  description = <<-EOT
    Keys read from the hand-edited app secret (<project>/<environment>/backend-app) and
    injected as env vars. Every key listed here must exist in that secret's JSON, or
    tasks fail to start. Only add optional keys (GOOGLE_CLIENT_SECRET, SENTRY_DSN,
    VAPID_* …) once they hold a real value: the backend rejects empty strings for
    some of them. SMTP_USER and SMTP_PASS may stay empty for a server without login.
  EOT
  type        = list(string)
  default     = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "SMTP_USER", "SMTP_PASS"]
}

variable "web_extra_env" {
  description = "Extra runtime env vars for the Next.js server. NEXT_PUBLIC_* values are baked in at image build time (GitHub variables), not here."
  type        = map(string)
  default     = {}
}
