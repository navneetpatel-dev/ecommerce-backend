# Deployment (GitHub Actions → AWS)

Both apps ship the same way: **push to `main` → CI → Docker image → ECR → ECS Fargate**.
The AWS resources are created by hand (console or CLI); this page lists what the pipelines
and the apps expect of them.

```
                         ┌──────────────── VPC (2 AZs) ──────────────────────┐
  https://<app_domain> ─┐│ public subnets      private subnets                │
                        ├┼▶ ALB ──host──▶ web   (Next.js, :3000)             │
  https://<api_domain> ─┘│     └─host──▶ api   (Express + Socket.IO, :9000) ─┼─▶ RDS Postgres 16 (TLS)
                         │               worker (BullMQ, schedulers)        ─┼─▶ ElastiCache Redis 7
                         │               migrate (one-off per deploy)        │
                         └───────────────────────────────────────────────────┘
  The S3 media bucket is reached through the backend task's IAM role — no AWS keys.
```

| Piece | Where |
| --- | --- |
| Backend CI (PRs) | `ecommerce-backend/.github/workflows/ci.yml` |
| Backend deploy (`main`) | `ecommerce-backend/.github/workflows/deploy.yml` — CI → image → migrations → API + worker |
| Web CI (PRs) | `ecommerce-web/.github/workflows/ci.yml` |
| Web deploy (`main`) | `ecommerce-web/.github/workflows/deploy.yml` — CI → image → web service |
| ECS helper | `.github/scripts/ecs-deploy.sh` (same file in both repos) |

Until step 4 below is done, the deploy jobs are **skipped** (they check for the
`AWS_DEPLOY_ROLE_ARN` variable), so pushes to `main` still run CI and nothing else.

---

## One-time setup

### 1. Prerequisites

- AWS CLI v2, logged in as an admin of the target account (`aws sts get-caller-identity`).
- A domain for the storefront and one for the API, e.g. `shop.example.com` and
  `api.shop.example.com`, with a TLS certificate (ACM) covering both.
- An SMTP server and login for outgoing email.
- The S3 uploads bucket ([`infra/s3/README.md`](../infra/s3/README.md)); its CORS rules must
  allow `https://<app_domain>`.

### 2. AWS resources

| Resource | Requirements |
| --- | --- |
| Network | VPC with public subnets (load balancer, NAT) and private subnets (tasks, database, Redis). Only the load balancer is reachable from outside; the database and Redis accept the API and worker only. |
| Load balancer | HTTPS, HTTP redirected. `<api_domain>` → API tasks on 9000, health check `/health/live`, sticky sessions. `<app_domain>` → web tasks on 3000, health check `/healthz`. Idle timeout 300 s. |
| RDS Postgres 16 | Private, encrypted, backups on, TLS required (`rds.force_ssl=1`). |
| ElastiCache Redis 7 | Private, TLS and auth token, eviction policy `noeviction` (the job queues must not lose keys). |
| ECR | One repository per app. |
| ECS cluster | Services for API, worker and web with the deployment circuit breaker and rollback on. The worker must never run twice (minimum healthy 0 %, maximum 100 %): it runs the schedulers. |
| Task definitions | `api` (`node dist/src/server.js`), `worker` (`node dist/src/worker.js`), `migrate` (`npx --no-install sequelize-cli db:migrate`), all from the backend image; `web` from the web image. Container names match these. Logs go to CloudWatch (`awslogs` driver). |
| IAM | A task execution role that may read the secrets; a backend task role with `s3:ListBucket` on the bucket and `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on its objects ([`iam-policy.json`](../infra/s3/iam-policy.json)). |
| GitHub deploy role | Assumed through GitHub's OIDC provider, limited to the `production` environment of the two repositories. May push to ECR, register and run task definitions, update services, pass the task roles and read the migration logs. |

### 3. Settings of the backend tasks (API, worker, migrate)

Plain environment variables:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `9000` |
| `TRUST_PROXY_HOPS` | `1` |
| `START_WORKERS_IN_API` | `false` |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | from RDS |
| `DB_SSL` | `true` |
| `AWS_REGION`, `S3_BUCKET` | the media bucket |
| `AWS_USE_DEFAULT_CREDENTIALS` | `true` (use the task role) |
| `CLIENT_URL` | `https://<app_domain>` |
| `GOOGLE_CALLBACK_URL` | `https://<api_domain>/api/auth/google/callback` |
| `SMTP_HOST` | required: the API does not start without it |
| `SMTP_PORT`, `SMTP_SECURE` | `587` and `false` (STARTTLS), or `465` and `true`. AWS restricts outbound port 25. |
| `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | the sender customers see |
| `MAIL_RATE_PER_MINUTE` | optional; keep it low for Gmail |

From Secrets Manager: `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (long random values,
different from each other), `REDIS_URL` (`rediss://:<auth token>@<endpoint>:6379`),
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SMTP_USER` and
`SMTP_PASS`. Add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `SENTRY_DSN` or `VAPID_*` only
with real values.

Email is sent over **SMTP only**; there is no other mail service or driver switch. Bad addresses
are handled from the server's reply at send time (hard bounces are not retried and go on a
30-day suppression list, visible in the admin Notifications page). There is no bounce/complaint
webhook.

The web task needs `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`,
`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SITE_URL`.

### 4. Wire up GitHub

In **each** repository:

1. *Settings → Environments → New environment* → `production`. Optionally add
   required reviewers to gate every deploy behind an approval.
2. *Settings → Secrets and variables → Actions → **Variables*** → add these **repository** variables:

   | Backend | Web |
   | --- | --- |
   | `AWS_REGION` | `AWS_REGION` |
   | `AWS_DEPLOY_ROLE_ARN` | `AWS_DEPLOY_ROLE_ARN` |
   | `ECR_REPOSITORY` | `ECR_REPOSITORY` |
   | `ECS_CLUSTER` | `ECS_CLUSTER` |
   | `ECS_API_SERVICE`, `ECS_WORKER_SERVICE` | `ECS_WEB_SERVICE` |
   | `ECS_MIGRATE_TASK` (task family) | `NEXT_PUBLIC_API_URL` |
   | `ECS_PRIVATE_SUBNETS` (comma separated) | `NEXT_PUBLIC_SITE_URL` |
   | `ECS_TASK_SECURITY_GRP` (the worker's) | |
   | `API_URL` | |

   Each service name must equal its task definition family: the deploy copies the family's
   latest revision and swaps the image.

   Web only, optional: `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `NEXT_PUBLIC_RAZORPAY_CHECKOUT_CONFIG_ID`,
   `GOOGLE_SITE_VERIFICATION` (public values baked into the web image).

   No AWS keys go into GitHub: the workflows assume `AWS_DEPLOY_ROLE_ARN` via OIDC.

3. *Settings → Branches → Add rule* for `main`: require a pull request and the status
   check **Typecheck, lint, build, test** (backend) / **Typecheck, lint, test, build** (web).

### 5. First deploy

Deploy the **backend first** (it creates the schema), then the web app:
*Actions → Deploy → Run workflow* in `ecommerce-backend`, wait for it to go green, then
the same in `ecommerce-web`.

### 6. Bootstrap production data (once)

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
Do not run `npm run db:seed` in production: it also loads the demo accounts and catalog (and refuses to).

**Upgrading to three roles:** migration `20261130000001-three-roles` turns every account that is not a super admin, vendor owner or customer into a customer (unlinked from its store and signed out). Check who holds those roles before deploying.
Output: `aws logs tail /ecs/ecommerce-production/backend --log-stream-names-prefix migrate --since 10m`.

Finally, point the Razorpay webhook at `https://<api_domain>/api/webhooks/razorpay`
and add `https://<api_domain>/api/auth/google/callback` to the Google OAuth client.

---

## Day to day

The commands below assume the cluster, services and log groups are named `ecommerce-production…`.

**Deploy:** merge to `main`. Each repo's Deploy workflow runs CI, then deploys.
The backend runs migrations as a one-off task *before* rolling the API and worker;
a failed migration stops the deploy with nothing rolled out.

**Rollback:** open the last good run of *Deploy* and click **Re-run all jobs**. It redeploys
that commit's image if ECR still holds it. ECS also rolls back by itself if new tasks fail
health checks (circuit breaker), and the workflow then fails rather than reporting success.
Migrations are not reversed. Keep them backwards-compatible with the previous release.

**Change env vars / secrets:** register a new revision of the task definition (or edit the
secret), then *Run workflow* on Deploy: the deploy copies the latest revision and swaps only
the image. Changing a `NEXT_PUBLIC_*` variable needs a web redeploy, which rebuilds the image.

**Logs:**
```bash
aws logs tail /ecs/ecommerce-production/backend --follow --log-stream-names-prefix api
aws logs tail /ecs/ecommerce-production/backend --follow --log-stream-names-prefix worker
aws logs tail /ecs/ecommerce-production/web --follow
```

**Shell into a running task** (needs ECS Exec enabled on the service):
```bash
TASK=$(aws ecs list-tasks --cluster ecommerce-production --service-name ecommerce-production-api --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster ecommerce-production --task $TASK --container api --interactive --command sh
```

---

## Things to know

- **Keep the API at one task for now.** Socket.IO rooms live in process memory; with
  two API tasks a delivery-tracking subscriber may sit on a different task than the
  emitter. Add `@socket.io/redis-adapter` before running more
  (use sticky sessions for the long-polling handshake).
- **Database TLS:** the app encrypts but doesn't verify the RDS certificate
  (`rejectUnauthorized: false`, same as the migration config). Bundling the RDS CA and
  verifying is a later hardening step.
- **Old IAM user keys** for S3 are not needed on AWS (`AWS_USE_DEFAULT_CREDENTIALS=true`
  uses the task role). Once production runs, consider deactivating that IAM user's keys
  if nothing else uses them.
- **Always-on cost** comes from the NAT gateway, load balancer, RDS and ElastiCache. Fargate
  tasks are the variable part.
- **Single-host alternative:** `docker-compose.prod.yml` runs Postgres + Redis on one
  machine (localhost-only ports, Redis password). It is not used by the AWS setup.
