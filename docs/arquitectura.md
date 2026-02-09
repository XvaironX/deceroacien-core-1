# Mapa de arquitectura (practica)

```
[Nav/Browser]
    | HTTPS
    v
[Load Balancer]
    |------------------------------
    |                              |
    v                              v
[Bucket GCS - frontend estatico]   [Cloud Run - backend Flask]
                                       |
                                       v
                                [PostgreSQL gestionado]
```

Notas:
- Auth via Supaabase (Google OAuth). El frontend obtiene el token y lo envia al backend Flask cuando necesite endpoints protegidos.
- Bucket sirve `frontend/public` completo; Cloud Run expone API (`/health`, `/public-config`, `/payments`, `/webhook`, `/enrollments`).
- PostgreSQL puede ser Supabase Postgres o Cloud SQL. Mantener FKs en UUID y usar SSL.
