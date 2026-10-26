# Deployment (GitHub Actions → AWS)

Both apps ship the same way: **push to `main` → CI → Docker image → ECR → ECS Fargate**.
Infrastructure is Terraform in [`infra/terraform`](../infra/terraform).

```
                         ┌──────────── VPC (eu-north-1, 2 AZs) ──────────────┐
  https://<app_domain> ─┐│ public subnets      private subnets                │
                        ├┼▶ ALB ──host──▶ web   (Next.js, :3000)             │
  https://<api_domain> ─┘│     └─host──▶ api   (Express + Socket.IO, :9000) ─┼─▶ RDS Postgres 16 (TLS)
                         │               worker (BullMQ, schedulers)        ─┼─▶ ElastiCache Redis 7 (TLS + auth)
                         │               migrate (one-off per deploy)        │
                         └───────────────────────────────────────────────────┘
  S3 media bucket (existing) and SES are reached through the backend task's IAM role — no AWS keys.
```

| Piece | Where |
| --- | --- |
| Backend CI (PRs) | `ecommerce-backend/.github/workflows/ci.yml` |
| Backend deploy (`main`) | `ecommerce-backend/.github/workflows/deploy.yml` — CI → image → migrations → API + worker |
| Terraform checks | `ecommerce-backend/.github/workflows/infra.yml` — fmt, validate, offline plan tests |
| Web CI (PRs) | `ecommerce-web/.github/workflows/ci.yml` |
| Web deploy (`main`) | `ecommerce-web/.github/workflows/deploy.yml` — CI → image → web service |
| ECS helper | `.github/scripts/ecs-deploy.sh` (same file in both repos) |
| Infrastructure | `ecommerce-backend/infra/terraform` |

Until step 5 below is done, the deploy jobs are **skipped** (they check for the
`AWS_DEPLOY_ROLE_ARN` variable), so pushes to `main` still run CI and nothing else.

---

## One-time setup

### 1. Prerequisites

- AWS CLI v2, logged in as an admin of the target account (`aws sts get-caller-identity`).
- Terraform ≥ 1.6.
- A domain for the storefront and one for the API, e.g. `shop.example.com` and
  `api.shop.example.com`. Easiest if the zone is in Route 53 (Terraform then issues
  the certificate and DNS records).

### 2. (Recommended) Remote Terraform state

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws s3api create-bucket --bucket ecommerce-terraform-state-$ACCOUNT \
  --region eu-north-1 --create-bucket-configuration LocationConstraint=eu-north-1
aws s3api put-bucket-versioning --bucket ecommerce-terraform-state-$ACCOUNT \
  --versioning-configuration Status=Enabled
```

Then uncomment the `backend "s3"` block in `infra/terraform/versions.tf` and fill in the bucket name.

### 3. Create the infrastructure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in domains, bucket, mail sender
terraform init
terraform plan
terraform apply                                 # ~15–20 min, mostly RDS + ElastiCache
```

ECS services start right away and **fail to pull the `:initial` image until the
first deploy** (step 7). That is expected.

Not using Route 53? Leave `route53_zone_id` empty, request a certificate for both
names in ACM (eu-north-1) yourself, set `acm_certificate_arn`, and point both
domains at the `alb_dns_name` output (CNAME/ALIAS).

### 4. Fill in third-party secrets

Terraform generates the DB password, JWT keys and Redis URL itself
(`ecommerce/production/backend-generated` — don't edit it). Your own credentials go in
`ecommerce/production/backend-app` (Secrets Manager console → *Retrieve secret value* → *Edit*):

```json
{
  "RAZORPAY_KEY_ID": "rzp_live_…",
  "RAZORPAY_KEY_SECRET": "…",
  "RAZORPAY_WEBHOOK_SECRET": "…"
}
```

To add more (e.g. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `SENTRY_DSN`, `VAPID_*`):
put the key in this secret **with a real value**, add its name to
`backend_app_secret_keys` in `terraform.tfvars`, `terraform apply`, then redeploy.
Plain non-secret settings go in `backend_extra_env` instead.

### 5. Email (SES)

`mail_driver` defaults to `ses`. In the SES console (eu-north-1): verify the sending
domain/address used in `mail_from_email`, then request **production access** (until
then SES only delivers to verified addresses). Set `mail_driver = "console"` to defer this.

### 6. Wire up GitHub

In **each** repository:

1. *Settings → Environments → New environment* → `production`. Optionally add
   required reviewers to gate every deploy behind an approval.
2. *Settings → Secrets and variables → Actions → **Variables*** → add every key from
   the matching Terraform output as a **repository** variable:

   ```bash
   cd infra/terraform
   terraform output -json github_variables_backend \
     | jq -r 'to_entries[] | "\(.key) \(.value)"' \
     | while read -r k v; do gh variable set "$k" --body "$v" -R navneetpatel-dev/ecommerce-backend; done

   terraform output -json github_variables_web \
     | jq -r 'to_entries[] | "\(.key) \(.value)"' \
     | while read -r k v; do gh variable set "$k" --body "$v" -R navneetpatel-dev/ecommerce-web; done
   ```

   Web only, optional: `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `NEXT_PUBLIC_RAZORPAY_CHECKOUT_CONFIG_ID`,
   `GOOGLE_SITE_VERIFICATION` (public values baked into the web image).

   No AWS keys go into GitHub: the workflows assume `AWS_DEPLOY_ROLE_ARN` via OIDC,
   and only jobs in the `production` environment of these two repos may do so.

3. *Settings → Branches → Add rule* for `main`: require a pull request and the status
   check **Typecheck, lint, build, test** (backend) / **Typecheck, lint, test, build** (web).

### 7. First deploy

Deploy the **backend first** (it creates the schema), then the web app:
*Actions → Deploy → Run workflow* in `ecommerce-backend`, wait for it to go green, then
the same in `ecommerce-web`.

### 8. Bootstrap production data (once)

Demo seeders refuse to run in production. Seed only the reference data, with an
explicit opt-in. Pick a strong admin password and change it after the first login:

```bash
CLUSTER=ecommerce-production
SUBNETS=$(gh variable get ECS_PRIVATE_SUBNETS -R navneetpatel-dev/ecommerce-backend)
SG=$(gh variable get ECS_TASK_SECURITY_GRP -R navneetpatel-dev/ecommerce-backend)

aws ecs run-task --cluster $CLUSTER --task-definition ecommerce-production-migrate \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG]}" \
  --overrides '{"containerOverrides":[{"name":"migrate",
    "command":["sh","-c","npx sequelize-cli db:seed --seed 20240101000001-seed-roles-permissions.js && npx sequelize-cli db:seed --seed 20240101000002-seed-default-admin.js && npx sequelize-cli db:seed --seed 20240101000004-seed-platform-settings.js"],
    "environment":[{"name":"ALLOW_PROD_SEED","value":"true"},
                   {"name":"ADMIN_EMAIL","value":"you@yourdomain.com"},
                   {"name":"ADMIN_PASSWORD","value":"<strong password>"}]}]}'
```

Add any other reference-data seeders you rely on (e.g. `20260930000010-seed-platform-shipping-fallback.js`).
Output: `aws logs tail /ecs/ecommerce-production/backend --log-stream-names-prefix migrate --since 10m`.

Finally, point the Razorpay webhook at `https://<api_domain>/api/webhooks/razorpay`
and add `https://<api_domain>/api/auth/google/callback` to the Google OAuth client.

---

## Day to day

**Deploy:** merge to `main`. Each repo's Deploy workflow runs CI, then deploys.
The backend runs migrations as a one-off task *before* rolling the API and worker;
a failed migration stops the deploy with nothing rolled out.

**Rollback:** open the last good run of *Deploy* and click **Re-run all jobs**. Its image
is still in ECR (the last 30 are kept), so it redeploys in a couple of minutes. ECS
also rolls back by itself if new tasks fail health checks (circuit breaker), and the
workflow then fails rather than reporting success.
Migrations are not reversed. Keep them backwards-compatible with the previous release.

**Change env vars / secrets:** edit `terraform.tfvars` (or the `backend-app` secret),
`terraform apply`, then *Run workflow* on Deploy. Terraform owns env and sizing.
The deploy only swaps the image, so the next deploy picks the change up.
Changing a `NEXT_PUBLIC_*` variable needs a web redeploy, which rebuilds the image.

**Logs:**
```bash
aws logs tail /ecs/ecommerce-production/backend --follow --log-stream-names-prefix api
aws logs tail /ecs/ecommerce-production/backend --follow --log-stream-names-prefix worker
aws logs tail /ecs/ecommerce-production/web --follow
```

**Shell into a running task:**
```bash
TASK=$(aws ecs list-tasks --cluster ecommerce-production --service-name ecommerce-production-api --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster ecommerce-production --task $TASK --container api --interactive --command sh
```

**Scale:** `api_desired_count`, `web_desired_count`, `*_cpu`, `*_memory` in `terraform.tfvars`.

---

## Things to know

- **Keep the API at one task for now.** Socket.IO rooms live in process memory; with
  two API tasks a delivery-tracking subscriber may sit on a different task than the
  emitter. Add `@socket.io/redis-adapter` before raising `api_desired_count`
  (the ALB already uses sticky sessions for the long-polling handshake).
- **Database TLS** is required (`rds.force_ssl=1`). The app encrypts but doesn't verify
  the RDS certificate (`rejectUnauthorized: false`, same as the migration config).
  Bundling the RDS CA and verifying is a later hardening step.
- **Old IAM user keys** for S3 are no longer needed on AWS (`AWS_USE_DEFAULT_CREDENTIALS=true`
  uses the task role). Once production runs, consider deactivating that IAM user's keys
  if nothing else uses them.
- **Always-on cost** comes from the NAT gateway, ALB, RDS and ElastiCache. Fargate tasks
  are the variable part. `single_nat_gateway = true` (default) keeps NAT to one.
- **Single-host alternative:** `docker-compose.prod.yml` runs Postgres + Redis on one
  machine (localhost-only ports, Redis password). It is not used by the AWS setup.
