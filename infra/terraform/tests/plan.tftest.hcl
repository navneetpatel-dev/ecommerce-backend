# Offline plan tests: `terraform test` with mocked providers — no AWS account or
# credentials needed. Runs in CI (.github/workflows/infra.yml).

mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_availability_zones" { defaults = { names = ["eu-north-1a", "eu-north-1b", "eu-north-1c"] } }
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:eu-north-1:123456789012:certificate/x"
      domain_validation_options = [
        { domain_name = "shop.example.com", resource_record_name = "_a.shop.example.com", resource_record_type = "CNAME", resource_record_value = "_b.acm" },
        { domain_name = "api.shop.example.com", resource_record_name = "_a.api.shop.example.com", resource_record_type = "CNAME", resource_record_value = "_c.acm" },
      ]
    }
  }
  mock_resource "aws_iam_openid_connect_provider" { defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::123456789012:role/x" } }
  mock_resource "aws_secretsmanager_secret" { defaults = { arn = "arn:aws:secretsmanager:eu-north-1:123456789012:secret:x" } }
  mock_resource "aws_cloudwatch_log_group" { defaults = { arn = "arn:aws:logs:eu-north-1:123456789012:log-group:x" } }
  mock_resource "aws_lb" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:loadbalancer/app/x/1", dns_name = "x.elb.amazonaws.com", zone_id = "Z23TAZ7KDG4SYC" } }
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:targetgroup/x/1" } }
  mock_resource "aws_lb_listener" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:listener/app/x/1/2" } }
  mock_resource "aws_acm_certificate_validation" { defaults = { certificate_arn = "arn:aws:acm:eu-north-1:123456789012:certificate/x" } }
  mock_resource "aws_ecs_cluster" { defaults = { arn = "arn:aws:ecs:eu-north-1:123456789012:cluster/x", id = "arn:aws:ecs:eu-north-1:123456789012:cluster/x" } }
  mock_resource "aws_ecs_task_definition" { defaults = { arn = "arn:aws:ecs:eu-north-1:123456789012:task-definition/x:1" } }
  mock_resource "aws_ecr_repository" { defaults = { arn = "arn:aws:ecr:eu-north-1:123456789012:repository/x", repository_url = "123456789012.dkr.ecr.eu-north-1.amazonaws.com/x" } }
}
mock_provider "random" {
  mock_resource "random_password" { defaults = { result = "AbCdEfGh0123456789AbCdEfGh012345" } }
}

variables {
  app_domain        = "shop.example.com"
  api_domain        = "api.shop.example.com"
  media_bucket_name = "media-bucket"
}

run "route53_mode" {
  command = apply
  variables { route53_zone_id = "Z123" }
  assert {
    condition     = length(aws_route53_record.app) == 2 && length(aws_route53_record.cert_validation) == 2
    error_message = "DNS records not created"
  }
  assert {
    condition     = length(aws_subnet.private) == 2 && length(aws_nat_gateway.main) == 1
    error_message = "network shape wrong"
  }
  assert {
    condition     = contains([for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e.name], "AWS_USE_DEFAULT_CREDENTIALS")
    error_message = "api env missing"
  }
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.worker.container_definitions)[0].secrets) == 7
    error_message = "worker secrets wrong"
  }
}

run "byo_cert_mode" {
  command = apply
  variables {
    acm_certificate_arn         = "arn:aws:acm:eu-north-1:123456789012:certificate/byo"
    create_github_oidc_provider = true
    single_nat_gateway          = false
  }
  assert {
    condition     = aws_lb_listener.https.certificate_arn == "arn:aws:acm:eu-north-1:123456789012:certificate/byo" && length(aws_route53_record.app) == 0
    error_message = "byo cert not used"
  }
  assert {
    condition     = length(aws_nat_gateway.main) == 2
    error_message = "per-AZ NAT not created"
  }
}

run "missing_cert_fails" {
  command         = plan
  expect_failures = [aws_lb_listener.https]
}
