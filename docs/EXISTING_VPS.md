# Deploy beside the existing website

The existing `https://skygreenline-lab.io/` site uses Nginx. Preserve its application, server blocks, certificates, services, database and root routing. Sky Meet belongs only under `/skymeet/`, with its own directory, secrets and data volume. Do not replace the root site's configuration with Sky Meet's example edge.

The Compose `edge` service is opt-in through the `standalone-edge` profile. Leave that profile disabled on this VPS. Before starting any Sky Meet service, inspect current listeners and containers: its default private ports 8000, 8080, 7880, 7883 and 6379 must not collide with existing services. Any port adjustments must be applied consistently to API startup/health checks, frontend/gateway upstreams, Redis, LiveKit and webhook settings.

Deployment sequence:

1. Push reviewed application source to `Tabook22/skymeet`. Exclude `.env`, generated LiveKit config, databases, assets, local credentials and reports.
2. Connect by SSH and inventory the current site, Nginx includes, listeners, containers, firewall and resources. Record the root site's status and content checksum. Back up the exact Nginx configuration before changing it.
3. Clone into a new dedicated directory (for example `/opt/skymeet`) or fast-forward an existing verified checkout. Use a dedicated Compose project name (`docker compose -p skymeet ...`). Never overwrite another application's checkout or volumes.
4. Create production secrets on the VPS, configure the private services and resolve port conflicts. Decide separately whether to migrate the local workspace data or initialize a fresh production administrator. Never seed sample accounts in production.
5. Build from the pulled commit. Start only Sky Meet's private services after checking the port plan. Verify its health and static routes on loopback first.
6. Add the two locations in `deploy/nginx-skymeet.locations.conf.example` inside the domain's existing HTTPS server block, adapting only the Sky Meet upstream port if necessary. Keep the root routing unchanged. Run `nginx -t` and reload only if valid. Verify both `/` and `/skymeet/`, the API, login and asset routes.
7. Configure a separate media WSS hostname and TURN endpoint with certificates, DNS and firewall rules appropriate to the existing edge. The bundled TURN example assumes the standalone layer-4 edge and is **not** ready to use behind ordinary HTTP Nginx unchanged. Do not take over port 443 or expose the raw LiveKit signaling port to work around this. Complete media/TURN configuration and a real call test before declaring the deployment complete.
8. Verify the root site's recorded checks still pass. Roll back only the newly added Sky Meet routing if necessary; leave the existing application running.

References: [Nginx proxy URI handling](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass), [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/).
