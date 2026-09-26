# Deploy beside the existing website

The existing `https://skygreenline-lab.io/` site uses Nginx. Preserve its application, server blocks, certificates, services, database and root routing. Sky Meet belongs only under `/skymeet/`, with its own directory, secrets and data volume. Do not replace the root site's configuration with Sky Meet's example edge.

The Compose `edge` service is opt-in through the `standalone-edge` profile. Leave that profile disabled on this VPS. Before starting any Sky Meet service, inspect current listeners and containers: its default private ports 8000, 8080, 7880, 7883 and 6379 must not collide with existing services. Any port adjustments must be applied consistently to API startup/health checks, frontend/gateway upstreams, Redis, LiveKit and webhook settings.

Deployment sequence:

1. Push reviewed application source to `Tabook22/skymeet`. Exclude `.env`, generated LiveKit config, databases, assets, local credentials and reports.
2. Connect by SSH and inventory the current site, Nginx includes, listeners, containers, firewall and resources. Record the root site's status and content checksum. Back up the exact Nginx configuration before changing it.
3. Clone into `/home/nasser/skymeet` or fast-forward that verified checkout. Use `docker compose -p skymeet -f compose.yaml -f compose.vps.yaml ...`. Never overwrite another application's checkout or volumes.
4. Create production secrets on the VPS, configure the private services and resolve port conflicts. Decide separately whether to migrate the local workspace data or initialize a fresh production administrator. Never seed sample accounts in production.
5. Build from the pulled commit. Start only Sky Meet's private services after checking the port plan. Verify its health and static routes on loopback first.
6. Run `sudo python3 /home/nasser/skymeet/deploy/activate_existing_vps.py` in an authenticated SSH terminal. This host-specific script checks the previously inspected Nginx and existing page checksums, backs up the configuration, adds only the Sky Meet snippet, validates Nginx and reloads it. It rolls back its routing change if the checks fail. Review new checksums before reusing on a changed VPS.
7. Signaling uses `wss://skygreenline-lab.io/skymeet/media` through the authenticated gateway on loopback port 7883. LiveKit's raw port 7880 stays private. Direct media uses TCP 7881 and UDP 7882. A separate Coturn container uses UDP 34790, TLS 53490 and UDP relay range 52000–52100. The activation script copies the existing domain certificate into a private Sky Meet directory and installs a renewal hook; it preserves the original TURN service on 3478/5349. Configure matching Hostinger firewall allowances if enabled. TURN on port 53490 may be blocked by networks that permit only port 443. Complete an external call and forced relay test before declaring media verified.
8. Verify the root site's recorded checks still pass. Roll back only the newly added Sky Meet routing if necessary; leave the existing application running.

References: [Nginx proxy URI handling](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass), [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/).
