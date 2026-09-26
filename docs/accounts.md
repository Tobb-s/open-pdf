# Cuentas personales y proveedores

`/es/account` y `/en/account` permiten entrar o registrarse por correo y contraseña con Auth0. No requieren comprar un dominio: el subdominio de Vercel es suficiente. Se provisionaron Auth0 Free y Neon Free; no se habilitó ningún plan pago. Sus cuotas siguen aplicándose. El consumo de IA corresponde al proveedor y a la clave de cada usuario, independientemente del alojamiento de OpenPDF.

## Privacidad y aislamiento

- Los PDF, OCR y resultados siguen locales. La cuenta almacena configuraciones de proveedores, no documentos.
- Auth0 gestiona las contraseñas y sesiones. OpenPDF usa cookies HTTP-only del SDK, con vencimiento absoluto de siete días e inactividad máxima de un día.
- La identidad para todas las consultas combina el tenant emisor con el identificador autenticado. No se acepta un dueño indicado por el navegador.
- Las claves se cifran con AES-256-GCM, nonce aleatorio y datos autenticados que vinculan dueño, registro, proveedor, modelo y URL. La clave del cifrado permanece únicamente en el servidor.
- El listado sólo devuelve nombre, proveedor, modelo, URL, identificador y los últimos cuatro caracteres de la clave.
- Para traducir con un proveedor guardado, el navegador manda su identificador. El servidor autentica la sesión, busca el registro de ese dueño y comprueba la configuración antes de descifrar y usar la clave.
- El modelo guardado es el predeterminado, no una restricción: su dueño puede elegir otro modelo sin volver a guardar la clave. Proveedor y destino siguen comprobándose; cambiar el modelo reinicia el consentimiento.
- «Consultar modelos de mi API» obtiene el catálogo actual de OpenAI con la clave temporal o el registro del usuario autenticado. No envía documentos, no genera respuestas y no usa una clave global. Se muestran todos los IDs; los modelos especializados y legacy incompatibles con el adaptador Responses/JSON se identifican por separado. El listado no garantiza saldo ni permiso para generar con cada ID. Se conserva entrada manual y reintento explícito.
- Nuevas configuraciones OpenAI usan `gpt-6-luna` como valor inicial. Los registros existentes mantienen su modelo. El ID de cuenta visible identifica al propio usuario; no es una credencial ni otorga acceso a otra cuenta.
- El borrado exige dueño e identificador. Un identificador ajeno da el mismo 404 que uno inexistente.
- Se conserva la alternativa de usar una clave temporal en memoria. Nunca se usa `OPENAI_API_KEY` del operador como reemplazo de una clave ausente.
- La API de revisión visual también admite el proveedor guardado de OpenAI y mantiene el consentimiento independiente para cada recorte.

## Configuración del servidor

Variables privadas: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `DATABASE_URL`, `ACCOUNT_VAULT_KEY`. La última debe ser una clave hexadecimal aleatoria de 32 bytes (64 caracteres) independiente del secreto de las cookies. No cambiarla sin migrar los registros: las claves guardadas dejarían de descifrarse. Ninguna variable lleva el prefijo `NEXT_PUBLIC_`.

Provisionar Auth0 y Neon antes de instalar los SDK. Preservar `.env.local` al descargar variables: `vercel env pull .env.development.local --yes`. No versionar ningún `.env*` ni `.vercel/`.

Crear el esquema con `node scripts/migrate-accounts.mjs`. El script es idempotente. No ejecutar DDL desde cada solicitud. La versión actual permite hasta 10 proveedores por cuenta; el límite es un control práctico y no una cuota distribuida estricta frente a altas simultáneas.

La integración nativa de Auth0 genera tenants separados para desarrollo, preview y producción y mantiene los callback URLs de Vercel. Los valores de `AUTH0_MANAGEMENT_API_*` de producción/preview son marcadores, no credenciales utilizables. `node scripts/configure-accounts.mjs` configura el entorno de desarrollo y reconoce esos marcadores. Verificar en el panel de producción que `Username-Password-Authentication` esté habilitada para la aplicación y que los callback/logout URLs incluyan el enlace publicado. No usar comodines generales.

Sin las variables de cuentas, las herramientas locales y la traducción con clave temporal siguen funcionando. «Mi cuenta» explica que el registro no está habilitado. Un fallo real del servidor devuelve un error acotado, sin credenciales ni respuestas privadas de proveedores.

## Alcance inicial

El primer acceso es por correo y contraseña. Usar una dirección Gmail no equivale a «Entrar con Google»: ese botón requiere un cliente OAuth propio y todavía no se ofrece.

Auth0 incluye un remitente de prueba, pero no soporta ese remitente para correos de producción. La recuperación/verificación por correo debe completarse con un proveedor gratuito que admita un remitente verificado sin comprar un dominio. No se debe anunciar recuperación por correo como validada hasta configurar y probar la entrega. No se guarda una clave global de IA mientras se resuelve ese paso.

## Verificación

`tests/account.test.ts` comprueba el cifrado autenticado, redacción de respuestas, dueño de las consultas, rechazo de destinos arbitrarios, claves ajenas, sesiones vencidas y solicitudes cruzadas. `e2e/account.spec.ts` comprueba navegación móvil, registro visible, selección de proveedores y borrado de la clave escrita después de guardar.

Prueba real optativa: `OPENPDF_REAL_ACCOUNT_TEST=1 npx playwright test e2e/account.real.spec.ts --workers=1`, contra un servidor local con las variables de desarrollo. Crea dos usuarios desechables verificados en el tenant de desarrollo, verifica persistencia y aislamiento, rechazo de identificadores ajenos y cierre de sesión. El `finally` elimina exclusivamente sus registros y usuarios. No habilitar esta prueba contra el tenant de producción ni incluir claves en capturas, traces o repositorio.
