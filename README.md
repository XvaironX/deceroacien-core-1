# deceroacien-core

Mini producto de practica para De Cero a Cien con frontend estatico, backend Flask y auth via Supabase.

## Prioridades detalladas
- Verificar frontend en local desde `frontend/public` y corregir enlaces rotos si aparecen.
- Definir y guardar fuera del repo las variables sensibles: ID real del proyecto GCP de practica, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (pendientes de rellenar por el instructor).
- Levantar backend Flask minimo en local con endpoints `/health` y `/public-config` leyendo las envs anteriores.
- Implementar gating basico en frontend: usar token de Supabase y simular entitlements en `localStorage` hasta conectar con backend.
- Publicar frontend en bucket GCS detras de Load Balancer HTTPS solo cuando el frontend este clickeable y probado en local.
- Desplegar backend Flask a Cldoud Run con envs configuradas y probar health/config.
- Conectar frontend→backend (config publica, headers de auth) y probar gating real. Si hay tiempo, simular pagos/webhook y enrolments.

## Uso rapido
1) Clona el repo y abre `frontend/public` en local (`python -m http.server 3000` o `npx serve`).
2) Configura las envs locales para backend: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PROJECT_ID` de GCP practica.
3) Ejecuta backend Flask en local y valida `/health` y `/public-config`.

## Documentacion
- Enunciado y alcance: `docs/enunciado-practica.md`.
- Mapa de arquitectura: `docs/arquitectura.md`.
- Esquema de BD: `backend/schema.sql`.


## ELIMINAR DEL REPO
- Eliminar cualquier referencia a secciones:
Liderazgo
Servicios Empresariales
Academia
Formación Semilla
Alianzas
Comunidad
El Camino Dorado
Servicios Empresariales
Academy
Gamificación
Diagnósticos con IA
Descargas Gratuitas
Conferencias
Soluciones a Medida
Liderazgo


## Arreglar error en Auth/Components.js/466:40
- error sobre auth/me

## Enrutamientos .cl
- cambiar deceroacien.app por deceroacien.cl de manera minuciosa cuidando no romper rutas.

## ESTILOS
- asociar estilos a docs legales

