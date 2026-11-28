# Development logins

The seed creates **1 super admin, 100 vendors and 100 customers**, all on random `@yopmail.com`
addresses. They are not written in this repository.

```bash
cd backend
npm run db:reset        # drops DB_NAME, migrates, seeds (about 2 minutes)
npm run db:seed:check   # re-runs the data checks
```

| File (git-ignored, in `backend/`) | Holds |
|---|---|
| `seed-accounts.local.md` | every account, grouped by role, with its password |
| `seed-accounts.local.csv` | role, name, email, password for all 201 accounts |
| `seed-accounts.local.json` | the same addresses, used again by the next reseed |

- Each role has one password.
- Delete both files before reseeding to get new addresses and passwords, and update
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` to match the new super admin.
- **A yopmail inbox has no password.** Anyone who knows an address can read its sign-in codes and
  password resets. Use these accounts for development only; never for a production super admin.
- The app sends real mail to these inboxes when `SMTP_HOST` is set.

## What the data holds

| | |
|---|---|
| Categories | 10 departments, 60 categories |
| Products | 6,200: every vendor has a live product in every category, plus 200 draft, pending, rejected and archived ones |
| Activity | 4,200 orders with returns, payouts, wallets, gift cards, coupons, reviews, Q&A, tickets and bug reports |
| Showcase | 20 products (from the first five vendors) with 100 reviews and 100 questions each |

Customers 1 to 3 in the sheet have opted in to marketing mail.
