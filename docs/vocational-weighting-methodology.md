# Metodología de ponderación vocacional v2

## Objetivo y fuentes

Blue ordena por afinidad los 462 programas canónicos; no predice éxito, diagnostica ni determina admisión. Fuentes consultadas el 18 de agosto de 2026: [INEGI CMPE 2016](https://www.inegi.org.mx/app/biblioteca/ficha.html?upc=702825086664); [UNESCO-UIS ISCED-F 2013](https://uis.unesco.org/en/topic/international-standard-classification-education-isced); [O*NET 30.3 Database](https://www.onetcenter.org/database.html), [Content Model](https://www.onetcenter.org/content.html), [Interest Profiler Manual](https://www.onetcenter.org/reports/IP_Manual.html) y sus [licencias](https://www.onetcenter.org/license_db.html); y Holland RIASEC. O*NET Database se atribuye bajo CC BY 4.0 a U.S. Department of Labor/Employment and Training Administration. No se copiaron preguntas del Interest Profiler.

RIASEC y las taxonomías sustentan la estructura. La combinación final es un modelo propio, calibrable y auditable de Blue, no una ponderación científicamente universal.

La base teórica incluye la formulación original de [Social Cognitive Career Theory de Lent, Brown y Hackett (1994)](https://doi.org/10.1006/jvbe.1994.1027), el meta-análisis de [Nye et al. (2012)](https://pubmed.ncbi.nlm.nih.gov/26168474/) y la revisión de [de Vries, Meeter y Huizinga (2024)](https://doi.org/10.1016/j.edurev.2024.100619). Esta última encuentra asociaciones positivas pequeñas y heterogeneidad metodológica; por ello Blue usa congruencia como apoyo a la reflexión y no como probabilidad de éxito.

## Datos externos reales

- CMPE 2016 e ISCED-F 2013 se almacenan por separado; las coincidencias de código no implican que ambas taxonomías sean intercambiables.
- El snapshot compacto `onetVocationalSnapshot.json` se derivó de O*NET Database 30.3. Contiene 21 ocupaciones utilizadas y, para cada una, RIASEC, los ocho elementos principales de Knowledge, Essential Skills, Abilities, Work Activities, Work Context y Work Styles. El ZIP oficial tuvo SHA-256 `78703906d5eb92faaa3d912164bbee7706658d85630143d9716df040f9a9f6aa`.
- `onetVocationalCrosswalkV2.json` transforma únicamente coincidencias exactas de `Element ID` a conceptos Blue; no usa coincidencia libre por substring. Knowledge alimenta `subjects`; Work Activities, `activities`; Abilities y Essential Skills, `abilities`; Work Context, `contexts`; y Work Styles, `workStyles`. Los valores se normalizan, se promedian determinísticamente cuando hay varias ocupaciones y conservan evidencia por SOC, elemento, nombre y valor.
- Si una dimensión mapeada no produce conceptos, solamente esa dimensión usa el crosswalk académico `DOMAINS`. Solo los perfiles con `occupationalMappings` citan O*NET en provenance; un fallback declara expresamente `O*NET not used`.

## Decisiones de ingeniería de Blue

Los pesos, thresholds, bandas de recencia, reglas de etapa, diversidad, pregunta discriminante y política de confianza son decisiones calibrables de Blue. No provienen directamente de CMPE, ISCED-F u O*NET.

## Mapping y procedencia

El generador procesa IDs y nombres canónicos en orden estable. Las excepciones semánticas preceden a reglas generales: ciberseguridad→ICT 061, veterinaria→0841, psicología→0313 y protección civil→1032, entre otras. CMPE e ISCED-F guardan independientemente `broad_field`, `narrow_field` o `detailed_field`; el nivel no se deduce de la longitud del código.

Cada regla ocupacional declara `onetSocCodes`, `mappingConfidence`, `mappingRationale` y `mappingType`. La confianza es un juicio semántico explícito: una sola ocupación puede ser medium o low y un agregado puede ser high. El auditor reporta reglas coincidentes, fallbacks generales, términos ambiguos y confianza taxonómica baja.

## Evidencia, correcciones y migración

La evidencia es el source of truth. Cada señal conserva concepto, dimensión (`interest`, `ability`, `preference`, `restriction`), polaridad, intensidad, fuente, revisión y fecha. Concepto + dimensión es la clave lógica: la señal reciente sustituye la anterior. Así, dificultad no borra interés; una corrección explícita sí reemplaza la señal de su dimensión. La migración v1→v2 conserva señales/exclusiones válidas.

## Fórmula y pesos

`score(p) = clamp(-100, 100, source + Σ(base × intensity/3 × recency × affinity) + 18 × max(0, cosine(userRIASEC, programRIASEC)) + stage)`

| Componente | Peso |
|---|---:|
| interés positivo / negativo | +14 / -22 |
| habilidad positiva / dificultad | +7 / -5 |
| preferencia positiva / negativa | +10 / -14 |
| restricción incompatible | -28; exclusión dura solo con contexto explícito revisado y confianza alta |
| RIASEC completo | 0 a +18 |
| etapa inmediata / trayectoria | +8 / -4 |
| solicitud / selección explícita | +38 / +44 |

Recencia por distancia de revisión: 0–8 = 1; 9–20 = 0.85; 21–40 = 0.70; más de 40 = 0.50. Una exclusión exacta de programa fija -100. Una restricción contextual solo hace hard block si `contextRestrictions` contiene evidencia explícita revisada con confianza alta; los contextos amplios o de fallback solo penalizan. Una petición explícita válida puede explorarse con evidencia escasa salvo exclusión vigente.

## Niveles y presentación

Secundaria prioriza bachillerato/técnico; preparatoria, TSU/licenciatura/ingeniería; TSU, licenciatura/ingeniería; licenciatura, especialidad/maestría; maestría, doctorado. `currentAcademicStage` tiene precedencia; cuando no existe, `completedAcademicStage` define únicamente afinidad de la siguiente etapa (licenciatura→especialidad/maestría, maestría→doctorado), sin afirmar admisión ni prerrequisitos.

Para especialidad, maestría y doctorado, `priorFields` compatible suma `field_continuity_match` (+10). Un campo previo conocido pero distinto produce `field_continuity_uncertain` (-3), nunca un bloqueo. Si el campo previo es desconocido no se presume. Bachillerato general usa campo/trayectoria, no una ocupación falsa.

Los 462 perfiles se rankean en memoria después de cada cambio V2; el límite histórico de 128 señales V1 no detiene V2. Solo pocos resultados llegan al LLM. Si los tres primeros están próximos, existe una señal no respondida que los discrimina, no hay selección explícita ni acción pendiente y no se preguntó lo mismo recientemente, Blue puede formular como máximo una pregunta determinística. Un ganador con ventaja mayor a 10 puntos no dispara pregunta. La base educativa decide instituciones. Ningún atributo sensible participa. Los IDs se validan contra catálogo y el máximo defensivo es 512.

## Limitaciones

Los fallbacks requieren revisión experta individual. Un título académico puede conducir a varias ocupaciones y O*NET describe el mercado estadounidense, no requisitos académicos mexicanos. Los pesos deben recalibrarse con evaluación de calidad y sesgos; los scores expresan orden de afinidad, no probabilidades.
