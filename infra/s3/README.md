# S3 bucket setup for media uploads

Three pieces must be configured: **IAM user permissions** (backend uploads), **bucket CORS** (browser → S3 PUT), and **bucket policy** (public read for catalog images).

The app falls back to server-side upload when pre-signed PUT fails, but **both paths need `s3:PutObject` on the IAM user** (`AWS_ACCESS_KEY_ID` in `.env`).

## 0. IAM user policy (fixes 403 / 500 on upload)

Backend logs like `User ... is not authorized to perform: s3:PutObject` mean the IAM user lacks write access.

Attach **`infra/s3/iam-policy.json`** to IAM user `ecommerce` (or whichever user owns the access keys in `.env`):

1. AWS Console → **IAM** → **Users** → `ecommerce` → **Add permissions** → **Create inline policy** → JSON.
2. Paste contents of `infra/s3/iam-policy.json`.
3. Save.

Or via CLI:

```bash
cd backend
aws iam put-user-policy \
  --user-name ecommerce \
  --policy-name EcommerceMediaUpload \
  --policy-document file://infra/s3/iam-policy.json
```

Required actions: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` on `ecommerce-317429618919-eu-north-1-an`.

Presigned PUTs also sign **exact `Content-Type` and `Content-Length`**, so S3 rejects uploads that exceed the declared size (or change type). The API requires `contentLength` on `/presign` and validates it against per-purpose max sizes before issuing the URL.

## 1. CORS (direct browser → S3 uploads)

Edit `cors.json` to include production `CLIENT_URL`, then:

```bash
aws s3api put-bucket-cors \
  --bucket ecommerce-317429618919-eu-north-1-an \
  --cors-configuration file://infra/s3/cors.json
```

## 2. Bucket policy (public read — fixes Access Denied when viewing images)

**Do not paste `bucket-policy.example.json` with placeholders** — use `bucket-policy.json`.

Before saving:

1. Bucket → **Permissions** → **Block public access** → edit → uncheck **“Block public access to buckets and objects granted through new public bucket policies”**.
2. Paste JSON from `bucket-policy.json`.

```bash
aws s3api put-bucket-policy \
  --bucket ecommerce-317429618919-eu-north-1-an \
  --policy file://infra/s3/bucket-policy.json
```

| Statement | Effect |
|-----------|--------|
| `PublicReadCatalogMedia` | Public **GET** on catalog objects |
| `DenyPublicKycDocuments` | **Deny** public GET on `*/vendors/*/kyc/*` |

## 3. Optional CDN

Set `S3_PUBLIC_BASE_URL` in `.env` to your CloudFront URL (no trailing slash).

## Verify

1. Upload a category image — Network: S3 PUT 200 or `POST /api/uploads` 201.
2. Open the returned URL — image renders (not Access Denied XML).
