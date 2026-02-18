## 1. Qué necesito para tener todo este proyecto online?
## 2. Está todo configurado para que el frontend se despliegue en un bucket GCS detrás de un Load Balancer HTTPS?
## 3. El backend Flask está desplegado en Cloud Run con las variables de entorno necesarias?
## 4. El frontend está conectado al backend y el gating de acceso funciona correctamente?
## 5. Se han corregido los enlaces rotos en el frontend y se han asociado los estilos a las secciones legales?
## 6. Se han eliminado todas las referencias a secciones de Camino Dorado y otros elementos no relacionados con el proyecto?
## 7. Se ha arreglado el error en `Auth/Components.js` relacionado con `auth/me`?
## 8. Se han cambiado todas las referencias de `deceroacien.app` a `deceroacien.cl` en los enrutamientos de manera minuciosa?
## 9. Se han probado los endpoints `/health` y `/public-config` del backend Flask para asegurar que están funcionando correctamente?
## 10. Se ha validado que el frontend es clickeable y probado en local antes de publicarlo en el bucket GCS?
## 11. Se han simulado pagos/webhooks y enrolments si el tiempo lo permite para probar el gating real en el frontend?
## 12. Se han configurado las variables sensibles fuera del repo y se han rellenado con los valores proporcionados por el instructor?
## 13. Se ha verificado que el frontend se despliega correctamente en local desde `frontend/public` y se han corregido los enlaces rotos si aparecieron?
## 14. Se ha clonado el repo y se ha abierto `frontend/public` en local para probar el frontend?
## 15. Se ha configurado el backend Flask en local con las variables de entorno necesarias y se ha validado que los endpoints funcionan correctamente?
## 16. Se ha implementado el gating básico en el frontend utilizando el token de Supabase y simulando los entitlements en `localStorage`?
## 17. Se ha publicado el frontend en el bucket GCS detrás del Load Balancer HTTPS solo después de probarlo en local?


### Sección Humana ###
- Verificar que todo esté en sus carpetas respectivas y que que los archivos estén correctamente vinculados
- verificar registro y login -NO DEMO- con SUPABASE_URL y SUPABASE_ANON_KEY mediante Auth Común y Login con Google
- Verificar Estilos en todos los archivos que lo necesiten.
- Corregir rutas de pago y postpago y crear las que aún no estén creadas.
- simular pagos con postman o similar para probar el gating real en el frontend.
- testear api de payku mediante su testing api rest https://testing-apirest.payku.cl/
- configurar api de payku siguiendo documentación oficial https://docs.payku.cl/api-rest/ y probar con postman o similar.