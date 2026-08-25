# 0002: Firmas electronicas visuales con auditoria

## Estado

Aceptada el 25 de agosto de 2026.

## Contexto

Una firma electronica visible puede escribirse, dibujarse o cargarse como imagen. Una firma
digital es distinta: usa un certificado, una clave privada y una operacion criptografica que
vincula la identidad y la integridad del archivo.

OpenPDF procesa los documentos enteramente en el navegador y no administra identidades,
certificados ni claves privadas. Crear un campo `/Sig` sin una firma criptografica valida seria
peor que no crearlo: un lector podria mostrarlo como una firma rota o engañosa.

## Decision

Studio ofrece una firma electronica visual con tres metodos: nombre escrito, trazo a mano o
imagen cargada. Cada firma incluye:

- nombre declarado por el firmante;
- fecha y hora ISO de colocacion;
- motivo opcional;
- metodo usado;
- hash SHA-256 de la apariencia;
- pagina final donde fue colocada.

La apariencia queda fija en la pagina y el registro se adjunta como JSON dentro del PDF. La
interfaz dice expresamente que no es una firma digital con certificado y que OpenPDF no
verifica identidad.

## Consecuencias

- El documento puede completarse y firmarse sin salir del navegador ni subirlo a un servidor.
- El registro permite inspeccionar que apariencia se uso, cuando y donde se coloco.
- El nombre y el motivo son declaraciones del usuario, no una prueba externa de identidad.
- La integridad criptografica y la validacion de identidad requieren una integracion futura con
  certificados o un proveedor de confianza; no se simulan en esta implementacion.
