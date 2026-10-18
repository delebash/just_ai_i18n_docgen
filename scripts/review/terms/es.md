# Term sheet — Spanish (neutral Latin American, tú)

Binding for every batch. Counts are proposals (A) in all three catalogs, measured 2026-10-17 on data.json.

## Style

- **Tú, Latin American.** Never usted, vos or vosotros (A: 234 strings with tú, 0 with usted). Use computadora,
  archivo, celular/teléfono, costo (not coste), video (not vídeo), ingresar (to type in a value), and **la PC**
  (feminine: "esta PC", "tu PC" — A: 29 feminine, 16 masculine).
- **Buttons, menu items, tabs, nav items, a tooltip that is only the button's name, and confirm-dialog titles:
  infinitive** — "Guardar", "Eliminar escena", "Crear tu primer capítulo", "¿Eliminar el motor?" (506 of the
  597 short verb labels already do this). The empty-state buttons "Create your first X" are buttons: "Crear tu
  primer X", never "Crea…". A noun label stays a noun ("Run" as a column = "Ejecución", not "Ejecutar").
  A feature name fixed in the table keeps its form everywhere, even where it is imperative ("Pregúntale al
  libro", "Muestra, no cuentes").
- **Instructions, placeholders and hints that tell the writer what to do: tú imperative** — "Elige un modelo…",
  "Haz clic en Reconstruir", "Primero añade un capítulo". **Descriptions of what the app or a feature does:
  present indicative, third person** — "Lee cada capítulo y…", "JustWrite mapea cada beat…".
- **Errors.** "Save failed" (verb) → "Error al guardar"; "<Noun> failed" → "Error en <el/la noun>" ("Error en
  la retrotraducción"); "Couldn't X" → "No se pudo X" (plural subject: "No se pudieron cargar los valores…");
  a full sentence keeps the verb ("El último intento falló."). A: "No se pudo/pudieron" 86 of 121, "Error al" 45.
  "Try again" in a sentence → "inténtalo de nuevo"; as a button → "Intentar de nuevo".
- **Empty states.** "No X yet." → "Aún no hay X." (49 of 50 already); "Nothing to X" → "No hay nada que X".
- **Status words** (done, failed, cancelled, skipped) are masculine singular participles: "completado",
  "fallido", "cancelado", "omitido". The "Done" button is "Listo".
- **Sentence case.** Capitalise the first word and proper names only, also in feature and screen names
  ("Barrido de entidades", "Configuración rápida"). Language names, days and months lowercase.
- **A label quoted inside a sentence** ("press Load model", "open Tune & measure", "Settings → AI") is written
  with that label's own Spanish text from this sheet or its key, capitalised as the label: "presiona Cargar
  modelo", "abre Ajustar y medir", "Configuración → IA". Never leave the English label.
- **Agreement with placeholders.** An article before a `{…Term}` placeholder takes the gender of the Spanish
  term it renders: "una {locationTerm}" (ubicación), "un {strandTerm}" (hilo), "un {articleTerm}" (artículo).
- **Plurals:** the number before the noun, same number of forms ("{n} escena | {n} escenas").
- "e.g." → "p. ej." (75 strings already; replace bare "ej."). The em dash may stay or become ":" / ";" — not an
  error either way. Search-keyword strings (`*.keywords.*`) may keep English words beside the Spanish.

## Terms

| English | Spanish | note |
|---|---|---|
| beat (plot) | beat, pl. beats (el beat) | User rule. Never "ritmo" (that is pacing), "compás", "golpe" |
| beat sheet | hoja de beats | Not left as "beat sheet" (6 strings did); "Map to beat sheet" = "Mapear a la hoja de beats" |
| strand / narrative strand | hilo / hilo narrativo | User rule. Nav "Strands" = "Hilos". Never "línea", "hebra" |
| loose thread / dangling thread / open thread | cabo suelto / cabos sueltos | Not "hilo suelto": hilo is the strand. Marker type "Loose thread" = "Cabo suelto" |
| thread (CPU) | hilo | Hardware sense only (kit) |
| plural with a number | "{n} notas", "3 escenas" | User rule; never "Notas {n}", "Su capítulo {n}" |
| book / project / manuscript | libro / proyecto / manuscrito | |
| part / chapter / scene / act | parte / capítulo / escena / acto | |
| character | personaje | |
| location | ubicación | The entity type (45 vs "lugar" 15). "place" in prose = "lugar" |
| object / group / note | objeto / grupo / nota | |
| worldbuilding | construcción de mundos | The established term; replaces "construcción de mundo" (13) and "creación de mundos" |
| worldbuilding article | artículo de construcción de mundos | |
| article / category / entity / event | artículo / categoría / entidad / evento | |
| story bible | biblia de la historia | Not "biblia de historia", never "story bible" |
| story world | mundo de la historia | Sidebar section |
| Setting (the architecture doc, the world's setting) | Ambientación | Also "the world Setting", events of kind Setting (was "Escenario") |
| setting (where a scene happens) | escenario | "setting change" = "cambio de escenario" |
| Architecture | Arquitectura | |
| premise / genre | premisa / género | |
| cast | elenco | Not "reparto" (9 vs 3) |
| plot | trama | |
| plot board | tablero de trama | |
| plot point / turning point | punto de giro | |
| inciting incident | incidente incitador | "incitante" means enticing; was split 3/2 |
| midpoint | punto medio | |
| stakes | lo que está en juego | Never "apuestas"; "raise the stakes" = "aumentar lo que está en juego" |
| setup / payoff (foreshadowing) | planteamiento / resolución | |
| arc / hook / pacing / tension | arco / gancho / ritmo / tensión | |
| voice (a character's) | voz | |
| POV | POV (label) · punto de vista (prose) | "POV character" = "personaje del punto de vista" |
| outline / reverse outline | esquema / esquema inverso | |
| framework (story structure) | marco | "Map to a narrative framework" = "Mapear a un marco narrativo" |
| Hero's Journey | el viaje del héroe | Sentence case; "Save the Cat" stays as is |
| timeline (the view) | línea de tiempo | |
| timeline (chronology) | cronología | "timeline issues" = "problemas de cronología" |
| sheet (entity form) | ficha | "Save to sheet" = "Guardar en la ficha"; a printed page is "hoja" |
| draft (noun: the manuscript, a status) | borrador | |
| draft (verb: the AI drafts) | redactar | "Draft with AI" = "Redactar con IA"; never "bocetar" |
| drafting (the phase) | redacción | |
| drafted (status) | redactado | Not "borrador" |
| Draft: {name} (task label) | Redacción: {name} | Task labels are nouns ("Extracción de…", "Mapeo de…") |
| draft (speculative decoding) | borrador | "draft model" = "modelo borrador", "draft file" = "archivo de borrador" |
| synopsis | sinopsis | |
| blurb (back cover) | texto de contraportada | Not "sinopsis" (collides with synopsis) or "reseña" (a review) |
| logline / elevator pitch / pitch | logline / elevator pitch / pitch | Stay in English, masculine ("el logline") |
| recap / summary | resumen | "Session recap" = "Resumen de la sesión" |
| critique | crítica | |
| flag (a critique or audit finding) | alerta | Never "bandera", "marcador", "marca" |
| flag (verb: mark for review) / flagged | marcar / marcado | |
| flag (engine command-line option) | flag | Stays in English |
| marker | marcador | |
| pin (noun: a marker in the prose) | marcador | |
| pin (verb) / pinned | fijar / fijado | Never "Pin de…" |
| drop (a marker) | colocar | |
| drop (drag and drop) | soltar | |
| tag | etiqueta | |
| chip | etiqueta | "the chip above" = "la etiqueta de arriba" (8 strings already) |
| status (of an item) | estado | |
| tick / untick / unticked | marcar / desmarcar / desmarcado | |
| inline (edit in place) | directamente | |
| link (verb) / linked | vincular / vinculado | |
| link (noun) / Links (scene panel) | enlace / Enlaces | Also scene↔entity links (A: panel "Enlaces" ×4) |
| scene linking | vinculación de escenas | |
| mention / @-mention | mención | |
| highlight | resaltar / resaltado | |
| Relations / relationship | Relaciones / relación | |
| graph (Relations) / edge | gráfico / conexión | |
| Ask the book | Pregúntale al libro | Feature name, same form everywhere (nav, chat) |
| Fill from book | Completar desde el libro | Not "Rellenar" |
| entity sweep | barrido de entidades | |
| sweep | barrido | |
| scan | escanear / escaneo | |
| audit | auditoría | |
| analyse / analysis | analizar / análisis | |
| Brainstorm | Lluvia de ideas | |
| Multi-reader (panel) | Múltiples lectores / Panel de múltiples lectores | Not "Multilector", "lectura múltiple" |
| Marketing pack | Paquete de marketing | |
| Reader knowledge | Conocimiento del lector | |
| Relationship arc | Arco de la relación | |
| Foreshadowing | Presagios | |
| plot holes | agujeros de guion | |
| AI tell | indicio de IA | Not "rasgo de IA" |
| Sensory research pack | Paquete de investigación sensorial | |
| Unstuck (chip) / Get unstuck | Desbloquear / Salir del estancamiento | Not "Desbloqueado" |
| stuck (an AI task) | atascado | |
| Rewrite / Expand / Continue / Describe | Reescribir / Expandir / Continuar / Describir | Also inside sentences, never the English |
| Tighten | Condensar | Shortens, keeps meaning; replaces "Sintetizar", "Pulir", "Ajustar" |
| Rewrite / Continue with direction | Reescribir / Continuar con instrucciones | |
| direction (the writer's one-line instruction) | instrucción | "in that direction" (a way) = "en esa dirección" |
| line edit | edición de línea, pl. ediciones de línea | |
| Show don't tell | Muestra, no cuentes | The maxim; stays imperative |
| prose / writer / reader | prosa / escritor / lector | |
| Untitled | Sin título | |
| Trash / autosave / snapshot / version history | Papelera / autoguardado / instantánea / historial de versiones | |
| goal (word target) | meta | "Word goal" = "Meta de palabras" |
| deadline | fecha límite | |
| Home / sidebar | Inicio / barra lateral | |
| card / list view | vista de tarjetas / vista de lista | |
| AI | IA | Never "AI" |
| LLM / token / prompt | LLM / token / prompt | Stay; "el prompt", "los tokens" |
| model | modelo | |
| local model | modelo local | |
| default (adj.) / defaults | predeterminado / valores predeterminados | Not "por defecto" |
| Set as default | Establecer como predeterminado | |
| provider | proveedor | |
| online provider | proveedor en línea | |
| engine / AI engine | motor / motor de IA | |
| feature | función | |
| Routing by feature | Enrutamiento por función | |
| task / AI tasks | tarea / Tareas de IA | |
| queue | cola | |
| Settings (the screen) | Configuración | Windows and Android LatAm usage; 33 vs 26. Paths too: "Configuración → IA" |
| App Settings / AI Settings | Configuración de la aplicación / Configuración de IA | |
| setting(s) (individual values) | ajuste(s) | "every appearance setting" = "cada ajuste de apariencia" |
| set up (verb) | configurar | |
| Quick Setup | Configuración rápida | Never "Quick Setup" |
| Setup (docgen's screen) | Configuración del proyecto | docgen also has Settings; "Configuración" alone collided |
| config | configuración | |
| applied config | configuración aplicada | "your applied config" = "tu configuración aplicada" |
| PC class / class config | clase de PC / configuración de clase | "PC class config" = "configuración de clase de PC" |
| launch (engine) / launch settings | inicio / configuración de inicio | Not "lanzamiento" |
| Global launch defaults | Valores predeterminados globales de inicio | "global" agrees with "valores" |
| layered defaults | valores predeterminados por capas | |
| switch (noun, engine) / engine switches | interruptor / interruptores del motor | Not "cambios de motor" |
| switch (verb) / switch back | cambiar / volver a | |
| tune (verb) / tune (noun) / tuned | ajustar / ajuste / ajustado | |
| Tune & measure | Ajustar y medir | The dialog's name; never "Tune & measure", "Sintonizar" |
| auto-tune | ajuste automático | Not "sintonización automática", "autoajuste", "auto-tune" |
| measure / measured / measurement | medir / medido / medición | |
| pass (a sweep) | pasada | Not "pase" |
| optimize / re-optimize | optimizar / volver a optimizar | |
| speed check | prueba de velocidad | |
| check (noun, automated) / check (verb) | comprobación / comprobar | |
| the Lab | el Laboratorio | "Lab test" = "Prueba de laboratorio" |
| preset | preajuste | Not "ajuste preestablecido": in the kit "ajuste" is a tune, a different object; "Tune presets" = "Ajustar preajustes" |
| built-in / custom / shipped | integrado / personalizado / de fábrica | |
| load / loaded / reload | cargar / cargado / recargar | |
| unload | quitar de la memoria | Never "descargar" (that is download): "Quitando de la memoria…" |
| warm (a model) | precargar | "warm-on-startup" = "precarga al iniciar" |
| offload (to RAM) | mover a la RAM | Never "descargar" |
| download / downloaded | descargar / descargado | |
| install / update | instalar / actualizar | |
| catalog | catálogo | Model catalog and docgen's string catalog |
| quant | cuantización | Not left as "quant" |
| weights | pesos | |
| repo | repo | |
| speculative decoding | decodificación especulativa | |
| MoE / dense | MoE / denso | "dense" was left in English |
| thinking / thinking budget | pensamiento / presupuesto de pensamiento | |
| reasoning | razonamiento | |
| streaming / stream | transmisión / transmitir | |
| embedding / embedding model | embedding (el), pl. embeddings / modelo de embedding | Never "incrustación" |
| semantic search | búsqueda semántica | |
| grounded chat | chat con base en datos | |
| index / build / rebuild | índice / construir / reconstruir | "Build index" = "Construir índice" |
| chunk | fragmento | |
| stale | desactualizado | Never "rancio", "estancado", "obsoleto" |
| hardware / GPU / CPU / VRAM / RAM | same | "video memory" = "memoria de video" |
| machine / computer | máquina / computadora | |
| desktop app | aplicación de escritorio | |
| app | aplicación | 43 vs 30; B uses it throughout |
| sync (noun / verb) | sincronización / sincronizar | The Sync section and page = "Sincronización"; "Sync now" = "Sincronizar ahora" |
| device | dispositivo | |
| pair / pairing / paired | emparejar / emparejamiento / emparejado | Not "vinculado" |
| library (sync) | biblioteca | Never "librería" (a bookstore) |
| join (a library) | unirte a | |
| cloud / cloud folder | nube / carpeta en la nube | |
| data folder | carpeta de datos | |
| backup | copia de seguridad | |
| restore / reset | restaurar / restablecer | |
| export / import | exportar / importar | |
| delete / remove (delete it) | eliminar | |
| remove (take off; the thing survives) | quitar | "Remove from group", "Remove tag", "Remove highlight" |
| clear (erase content: history, index, audit, log, cache) | borrar | Quasar's own "Clear" is "Borrar" |
| clear (reset filters, selection, focus) | limpiar | "Clear filters" = "Limpiar filtros" |
| add | añadir | 69 vs "agregar" 28; B uses añadir only |
| pick / choose | elegir | |
| select / selection | seleccionar / selección | |
| run (verb) | ejecutar | |
| run (noun: a job, a measurement) | ejecución | docgen nav "Runs" = "Ejecuciones" |
| click / hit (a button) | hacer clic en | "Haz clic en…"; not "dale", "pulsa" |
| press (a key; or as the English says) | presionar | |
| failed (status) | fallido | See Style for errors |
| Back / Back to X | Atrás / Volver a (article) X | "Volver a las ubicaciones" |
| OK | Aceptar | |
| Help / docs | Ayuda / documentación | docgen nav "Docs" = "Documentación" |
| Logs / log | Registros / registro | |
| Usage / cost | Uso / costo | |
| API key | clave de API | |
| appearance / theme / accent | apariencia / tema / acento | |
| light / dark (mode) | claro / oscuro | |
| font | fuente | |
| staged (docgen) | preparado | Not "en espera", "por etapas" |
| proposal | propuesta | |
| review / reviewer | revisar · revisión / revisor | |
| locale / locale file | idioma / archivo de idioma | |
| source / target (language, file, text) | origen / destino | "idioma de origen", "archivo de origen", "texto de origen" |
| back-translation | retrotraducción | |
| glossary / key / string | glosario / clave / cadena | |
| Hugging Face, llama.cpp, GGUF, JustWrite, docgen, Save the Cat | unchanged | Names (guide list) |
