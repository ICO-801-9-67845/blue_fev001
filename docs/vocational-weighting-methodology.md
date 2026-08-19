# Metodología de ponderación vocacional v2

## Objetivo y fuentes

Blue ordena por afinidad los 462 programas canónicos; no predice éxito, diagnostica ni determina admisión. Fuentes consultadas el 18 de agosto de 2026: [INEGI CMPE 2016](https://www.inegi.org.mx/app/biblioteca/ficha.html?upc=702825086664); [UNESCO-UIS ISCED-F 2013](https://uis.unesco.org/en/topic/international-standard-classification-education-isced); [O*NET 30.3 Database](https://www.onetcenter.org/database.html), [Content Model](https://www.onetcenter.org/content.html), [Interest Profiler Manual](https://www.onetcenter.org/reports/IP_Manual.html) y sus [licencias](https://www.onetcenter.org/license_db.html); y Holland RIASEC. O*NET Database se atribuye bajo CC BY 4.0 a U.S. Department of Labor/Employment and Training Administration. No se copiaron preguntas del Interest Profiler.

RIASEC y las taxonomías sustentan la estructura. La combinación final es un modelo propio, calibrable y auditable de Blue, no una ponderación científicamente universal.

La base teórica incluye la formulación original de [Social Cognitive Career Theory de Lent, Brown y Hackett (1994)](https://doi.org/10.1006/jvbe.1994.1027), el meta-análisis de [Nye et al. (2012)](https://pubmed.ncbi.nlm.nih.gov/26168474/) y la revisión de [de Vries, Meeter y Huizinga (2024)](https://doi.org/10.1016/j.edurev.2024.100619). Esta última encuentra asociaciones positivas pequeñas y heterogeneidad metodológica; por ello Blue usa congruencia como apoyo a la reflexión y no como probabilidad de éxito.

## Mapping y procedencia

El generador procesa IDs y nombres canónicos en orden estable y aplica reglas explícitas de familia/campo. La jerarquía es evidencia específica revisada → familia/especialidad → campo CMPE/ISCED. En v2 no se afirma equivalencia O*NET-SOC: los mappings ocupacionales quedan vacíos y los perfiles se marcan `medium` o `low`, con revisión pendiente. Cobertura no significa confianza perfecta.

## Evidencia, correcciones y migración

La evidencia es el source of truth. Cada señal conserva concepto, dimensión (`interest`, `ability`, `preference`, `restriction`), polaridad, intensidad, fuente, revisión y fecha. Concepto + dimensión es la clave lógica: la señal reciente sustituye la anterior. Así, dificultad no borra interés; una corrección explícita sí reemplaza la señal de su dimensión. La migración v1→v2 conserva señales/exclusiones válidas.

## Fórmula y pesos

`score(p) = clamp(-100, 100, source + Σ(base × intensity/3 × recency × affinity) + 18 × max(0, cosine(userRIASEC, programRIASEC)) + stage)`

| Componente | Peso |
|---|---:|
| interés positivo / negativo | +14 / -22 |
| habilidad positiva / dificultad | +7 / -5 |
| preferencia positiva / negativa | +10 / -14 |
| restricción incompatible | -28; exclusión dura con afinidad plena |
| RIASEC completo | 0 a +18 |
| etapa inmediata / trayectoria | +8 / -4 |
| solicitud / selección explícita | +38 / +44 |

Recencia por distancia de revisión: 0–8 = 1; 9–20 = 0.85; 21–40 = 0.70; más de 40 = 0.50. Exclusión exacta o restricción plenamente incompatible fija -100. Una petición explícita válida puede explorarse con evidencia escasa salvo exclusión vigente.

## Niveles y presentación

Secundaria prioriza bachillerato/técnico; preparatoria, TSU/licenciatura/ingeniería; TSU, licenciatura/ingeniería; licenciatura, especialidad/maestría; maestría, doctorado. Otras opciones son trayectorias, sin afirmar prerrequisitos. Bachillerato general usa campo/trayectoria, no ocupación falsa. Posgrados requieren continuidad de campo cuando exista evidencia.

Los 462 perfiles se rankean en memoria; solo pocos resultados llegan al LLM. El ranking completo se conserva para paginación y diversidad solo cambia presentación. La base educativa decide instituciones. Ningún atributo sensible participa. Los IDs se validan contra catálogo y el máximo defensivo es 512.

## Limitaciones

Los perfiles generados requieren revisión experta individual. No hay mappings O*NET-SOC high-confidence en este snapshot. CMPE/ISCED se asignan a campo amplio. Los pesos deben recalibrarse con evaluación de calidad y sesgos; los scores expresan orden de afinidad, no probabilidades.
