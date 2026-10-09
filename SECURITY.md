# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | yes       |
| < 1.0   | no        |

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on this repository ("Security" tab, "Report a
vulnerability"). You will get an acknowledgement within a few days and a fix
or mitigation plan before any public disclosure.

The generated schemas and the `strapi-schemas` CLI never ship secrets: the
plugin's HTTP endpoints only expose content-model structure, never data.
Reports about private attributes leaking into generated output are especially
welcome.
