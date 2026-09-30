# Research: cheap cloud hosting for the public demo LIMS

Ticket: #6 (part of map #1). Every price below was read from the provider's own pricing or docs page on **2026-09-29**, unless another date is shown. Prices change, so check them again before provisioning. USD, excluding VAT/sales tax.

## Recommendation

**Run everything on one Hetzner Cloud CX23 VPS (2 vCPU, 4 GB RAM, 40 GB NVMe, EU region) for about $8.40/month**, with Hetzner's daily backups turned on and a nightly off-site `pg_dump` plus report files pushed to Cloudflare R2's free tier.

- Cost: $6.49 server + $0.60 IPv4 + $1.30 backups (20% of the server price) = **$8.39/month** (€7.09 if the account bills in EUR). [H1][H2][H3]
- One box holds Postgres, the React/TS app, the Python PDF-extraction worker, and a TLS reverse proxy (Docker Compose). It has 4 GB RAM, while the $6-7 plans elsewhere give 1 GB. Postgres, a Node server and a Python PDF parser running together are uncomfortable in 1 GB.
- Trusted time is under our control: we run chrony against NTS-authenticated time (`time.cloudflare.com`, RFC 8915) [T2]. Hetzner also runs its own NTP servers [T1]. Postgres `now()` in UTC is the single clock for audit-trail entries. A PaaS container can't configure or check its host clock.
- Backups: Hetzner keeps 7 daily whole-server backups [H4]. That covers disaster recovery. The logical `pg_dump` to R2 covers "retrieve a record from months ago" and survives losing the Hetzner account. R2 gives 10 GB-month free and charges nothing for egress [S1].
- TLS without a custom domain: Let's Encrypt has issued publicly trusted **IP-address certificates** since January 2026. They are 6-day "shortlived" certificates [L1], and Certbot ≥ 5.4 can request them with `--ip-address --preferred-profile shortlived` [L2]. Caddy's docs say it gives IP addresses self-signed certificates only [C1], so the plan is Certbot plus Caddy/nginx. A cheap domain later removes this workaround.
- Ops burden: this is the price of the low bill. We handle OS patching (unattended-upgrades), a firewall, Docker updates, Postgres upgrades and backup restore drills ourselves. For a demo with fictional data that burden is acceptable, and it teaches exactly the backup and time controls that the Part 11 §11.10(c) work has to specify anyway.

**Fallback if the CX23 can't be ordered:** AWS Lightsail, $7/month (1 GB RAM, 2 vCPU, 40 GB SSD, static IPv4 included) plus daily auto-snapshots at $0.05/GB-month, about $8 in total [A1][A2][A3]. Swap is needed at 1 GB. When this was read, Hetzner's static cost-optimized page HTML contained "This product is currently unavailable. Please check back later." next to CX23 and CAX11 [H5]. That may be a hidden template string rather than real stock status. **Confirm in the Hetzner console before committing.**

## Comparison

Assumed workload: one web app (API + static React), one Python worker, Postgres around 1 GB, uploaded reports a few GB. "Monthly" is a realistic total for that workload, not the headline price.

| Provider / shape | ~Monthly (app + Postgres + storage + worker) | TLS | Backups | Ops burden | NTP / trusted time | Gotchas |
|---|---|---|---|---|---|---|
| **Hetzner CX23 VPS** (all-in-one) | **$8.39** ($6.49 + $0.60 IPv4 + $1.30 backups) [H1][H2][H3] | DIY: Certbot IP cert (6-day) or domain + Caddy [L1][L2][C1] | 7 daily server backups, 20% flat [H3][H4]; add own `pg_dump` off-site | High: we run the OS, Docker, Postgres | Full control: chrony + NTS [T2]; Hetzner NTP servers [T1] | Prices rose on 2026-06-15 (CX23 $4.99→$6.49) [H1]. CX line is EU only (US CPX11 is $20.49) [H1]. Page showed "currently unavailable" [H5]. IPv4 billed separately [H2] |
| **DigitalOcean Droplet** 1 GB / 2 GB | $7.20 (1 GB $6 + 20% weekly backups) / $14.40 (2 GB $12 + backups) [D1][D2] | DIY, as Hetzner | Weekly 20% or daily 30% of droplet price; usage-based options [D2] | High | Full control (chrony) | 1 GB is tight for PG + Node + Python; 2 GB is over budget with backups. Managed PG starts at $15.15 [D3] |
| **AWS Lightsail** 1 GB | ~$8 ($7 + snapshots at $0.05/GB-mo) [A1][A3] | DIY on the instance (Lightsail certs need an $18 load balancer) [A2] | Daily auto-snapshots, keeps latest 7 [A3] | High | Amazon Time Sync, public endpoint `time.aws.com`, leap-smeared [T3] | Short free trials replaced by AWS Free Tier credits [A2]. Managed DB $15 [A2]. 1 GB RAM |
| **Railway** Hobby | ~$8-12 est.: $5 plan includes $5 usage; RAM ~$10/GB-mo, vCPU ~$20/mo, volume $0.15/GB [R1] | Free `*.railway.app` domain with auto TLS [R3] | Volume backups: daily (kept 6 d), weekly (27 d), monthly (89 d), billed as storage [R2] | Low | Host clock, not configurable | Usage-based bill varies. **Hobby volume max 5 GB** [R1], which reports outgrow in 1-2 years (see below). Postgres is a container on a volume |
| **Render** paid | ~$21: web $7 + worker $7 + Postgres $6 (256 MB) + $0.30/GB DB + $0.25/GB disk [N1] | Included ("full TLS") [N1] | Postgres PITR 3 days on Hobby workspace [N1] | Low | Host clock | Over budget. Free tier unusable: web sleeps after 15 min (~1 min wake); **free Postgres expires after 30 days, 1 GB, no backups** [N2]. No free workers [N2] |
| **Fly.io** + Managed Postgres | ~$48: app 512 MB $6.48 + worker 256 MB $3.24 + MPG Basic $38 + $0.28/GB [F1][F2] | Managed certs, first 10 hostnames free [F1] | MPG "automatic backups" (retention not stated) [F2] | Low-medium | Host clock | MPG blows the budget. Trial is 7 days / 2 VM-hours only, no ongoing free tier [F3]. Dedicated IPv4 $2 [F1] |
| **Fly.io / any PaaS + free external Postgres** | ~$10 app + worker, DB $0 | Platform TLS | Neon free: 6 h PITR, 0.5 GB [P2]; Supabase free: **none** [P1] | Low | Host clock (DB clock is the provider's) | Supabase free **pauses after 1 week idle**, 500 MB [P1]. Neon free suspends after 5 min idle (cold starts) [P2]. An idle demo hits both |
| **Oracle Cloud Always Free** (A1 Arm VM) | $0: 2 OCPU / 12 GB equivalent, 200 GB block [O1] | DIY | DIY | High | Full control | **Idle instances are reclaimed** if 95th-pct CPU, network and memory all stay < 20% over 7 days [O1]. A quiet demo is exactly that |

## Can the recommended host carry the real lab's load?

Owner input (2026-09-29): the real lab runs 500+ samples/month with about 20 analysts and 3 managers (about 30 internal users plus Customer portal users). Revenue is over $1M/month. The demo stays at ≤ ~$10/month.

**Traffic: yes, easily.** At about 30 staff and a few hundred customer log-ins a month, the app serves a handful of requests per second at peak. A 2 vCPU / 4 GB box runs Postgres and a Node API at that scale with a wide margin. The only bursty work is PDF extraction, which runs one report at a time in the worker queue.

**Storage growth (estimate; the owner should supply real report sizes):**

| Item | Assumption | Per year |
|---|---|---|
| Instrument reports (PDF/TXT) | 500 samples/mo, worst case one report per sample (real LC-MS/MS runs batch many samples per sequence), 0.5-2 MB each | **3-12 GB** |
| Database rows incl. Part 11 audit trail | ~1 M audit rows/yr at ~1 KB, plus samples, results, equipment logs | ~1-2 GB |
| Document vault (SOPs, forms, methods) | Versioned, mostly text PDFs | < 1 GB |
| **Total** | | **~5-15 GB/yr** |

A 40 GB CX23 disk holds roughly 2-4 years of that after the OS and Docker images. Hetzner's backup price is a flat 20% whatever the size [H3]. Off-site on R2 is free up to 10 GB and $0.015/GB-month after that [S1], so about $0.20/month per extra 12 GB. The disk is not the constraint for the demo. Railway Hobby's 5 GB volume cap [R1] would be.

## Upgrade path to production-grade

The single VPS is a demo design. It has no high availability, a 24-hour backup granularity, and one person holds root. A regulated production lab with more than $1M/month revenue should buy managed durability. One concrete shape, priced from pages read on 2026-09-29 on DigitalOcean so every part comes from one vendor:

| Component | Choice | Monthly |
|---|---|---|
| App + worker | Droplet 4 GB / 2 vCPU / 80 GB [D1] + daily backups 30% [D2] | $24 + $7.20 |
| Postgres | Managed PG 2 GB with one standby node for automatic failover; daily backups + 7-day point-in-time recovery [D3][D4] | ~$61 (2 × $30.45; the page lists standby nodes as "additional nodes", check the exact standby price) |
| Report / document files | Spaces object storage, 250 GiB + 1 TiB egress included [D5] | $5 |
| Off-site copy | R2 or a second provider | ~$1 |
| Staging environment | Smaller copy of the above | ~$20-30 |
| **Total** | | **~$120-130/month** |

That is about 0.01% of monthly revenue. Production cost is set by compliance work, not hosting: vendor qualification or a supplier agreement, computer system validation (out of scope on the map), monitoring and alerting, a tested restore procedure, and records retention (the map's "Backup, retention and archiving" item). The demo's Docker Compose layout moves to that shape by pointing `DATABASE_URL` at the managed cluster and the file store at Spaces, so the code needs no redesign.

## Sources (all read 2026-09-29)

- [H1] Hetzner Price Adjustment 15 June 2026, cloud server table (excl. IPv4): https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- [H2] Hetzner Primary IPs pricing (IPv4 €0.50 / $0.60 per month; IPv6 free): https://docs.hetzner.com/cloud/servers/primary-ips/overview/
- [H3] Hetzner Cloud billing FAQ (backups = 20% of server price, 7 slots): https://docs.hetzner.com/cloud/billing/faq/
- [H4] Hetzner backups & snapshots overview (7 slots, daily): https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/
- [H5] Hetzner cost-optimized page (CX23 specs 2 vCPU / 4 GB / 40 GB NVMe / 20 TB traffic; "currently unavailable" text): https://www.hetzner.com/cloud/cost-optimized/
- [D1] DigitalOcean Droplet pricing: https://www.digitalocean.com/pricing/droplets
- [D2] DigitalOcean backup pricing: https://docs.digitalocean.com/products/backups/details/pricing/
- [D3] DigitalOcean managed database pricing: https://www.digitalocean.com/pricing/managed-databases
- [D4] DigitalOcean managed PostgreSQL features (daily backups, 7-day PITR, standby failover): https://docs.digitalocean.com/products/databases/postgresql/details/features/
- [D5] DigitalOcean Spaces pricing: https://www.digitalocean.com/pricing/spaces-object-storage
- [A1] AWS Lightsail pricing: https://aws.amazon.com/lightsail/pricing/
- [A2] Lightsail billing FAQ (free-trial change, managed DB $15, static IP, load-balancer certs): https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html
- [A3] Lightsail snapshots FAQ (daily, latest 7 kept, $0.05/GB-mo): https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-snapshots.html
- [R1] Railway pricing: https://railway.com/pricing
- [R2] Railway volume backups: https://docs.railway.com/reference/backups
- [R3] Railway public networking (railway.app domain, auto SSL): https://docs.railway.com/guides/public-networking
- [N1] Render pricing: https://render.com/pricing
- [N2] Render free tier limits: https://render.com/docs/free
- [F1] Fly.io pricing: https://docs.fly.io/about/pricing/
- [F2] Fly Managed Postgres: https://docs.fly.io/mpg/
- [F3] Fly.io free trial: https://docs.fly.io/about/free-trial/
- [P1] Supabase pricing: https://supabase.com/pricing
- [P2] Neon pricing: https://neon.com/pricing
- [O1] Oracle Cloud Always Free resources and idle reclamation: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- [S1] Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- [L1] Let's Encrypt, 6-day and IP address certificates GA (2026-01-15): https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability
- [L2] Let's Encrypt, six-day and IP certificates in Certbot (2026-03-11): https://letsencrypt.org/2026/03/11/shorter-certs-certbot
- [C1] Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https
- [T1] Hetzner NTP servers (ntp1.hetzner.de, ntp2.hetzner.com, ntp3.hetzner.net; documented under dedicated servers): https://docs.hetzner.com/robot/dedicated-server/security/ntp-servers/
- [T2] Cloudflare NTS time service (`time.cloudflare.com`, RFC 8915): https://developers.cloudflare.com/time-services/nts/
- [T3] Amazon Time Sync Service (`time.aws.com`, leap smearing): https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/set-time.html

## Not verified

- Whether the CX23 can be ordered right now (see [H5]).
- The retention window of Fly Managed Postgres backups, and whether Fly's legacy self-run Postgres is still offered (its docs URL returned 404).
- The Hetzner Object Storage base price (the page renders it with JavaScript), and whether Hetzner offers managed Postgres.
- Railway's monthly total is an estimate from unit prices, not a quote.
