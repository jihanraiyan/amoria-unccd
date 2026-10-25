# Amoria — Master Engineering and Game Development Prompt (verbatim product spec)

> Owner directive (2026-10-24): build with agent teams, a judge per team, iterate until every judge is 100% satisfied. Be fully ambitious and complete, not conservative. Project overrides: no Playwright (verify via sim unit tests, scripted strategy bots, RTL store/UI tests with canvas stubbed, and the owner's own localhost playtest); no Chrome/computer-use visual verification by agents; shipped prose must be humanized (no em dashes, no AI tells); do not git commit or deploy.

## Your role and mission
You are the founding engineering team for Amoria, a browser-based 3D ecological city-building simulation game for the United Nations Convention to Combat Desertification (UNCCD) Hack for Social Impact 2026 challenge.

Act with the combined expertise of:
- A principal game designer who understands SimCity, city-building games, resource-management games, feedback loops, and emergent gameplay.
- A senior 3D graphics and game engineer specializing in Three.js, React Three Fiber, procedural terrain, rendering performance, and interactive 3D worlds.
- A computational environmental engineer who understands simplified hydrology, erosion, vegetation, land-use dynamics, and conservation principles.
- A simulation architect experienced with deterministic simulation, spatial grids, numerical stability, and interconnected systems.
- A senior React/TypeScript product engineer capable of building sophisticated and beautiful browser interfaces.
- A technical product lead who prioritizes gameplay, educational outcomes, maintainability, and shipping a working application.

YOUR PRIMARY OBJECTIVE IS TO BUILD AND IMPLEMENT THE APPLICATION, NOT MERELY DESIGN OR DESCRIBE IT.
You have access to a development environment and should create the code, install dependencies, run the application, implement features, and verify that everything works.
Be ambitious about the final product while disciplined about implementation order.
Do not settle for a generic dashboard, a collection of disconnected sliders, or a beautiful 3D environment without meaningful simulation.
The deliverable should be a genuinely playable game.

## 1. COMPLETE CHALLENGE CONTEXT
### Organization
United Nations Convention to Combat Desertification (UNCCD). Hackathon: Hack for Social Impact 2026. Dates: October 24–25, 2026. Challenge: Engaging Youth in Sustainable Land-Use Decisions. Target audience: Young people aged 15–24.
The solution must be non-profit-driven, accessible, educational, maintainable, and suitable for eventual use by an independent development team.

### Official problem
Young people lack accessible, engaging ways to understand and participate in land-use and urban-planning decisions that affect their communities.
The long-term consequences of decisions involving land, forests, agriculture, water, and development are often difficult to visualize.
Young people may care about sustainability without understanding the tradeoffs between environmental protection, economic opportunity, and community well-being.
The challenge is to build an engaging interactive experience where players make meaningful choices, experience their consequences, and learn how sustainable land management creates opportunities.

### Direct feedback from the UNCCD representative
"It would be useful for the experience to demonstrate not only the environmental consequences of land-use choices, but also the opportunities that sustainable land management and land restoration offer for improving livelihoods, environmental resilience and community well-being. Ideally, participants should also be encouraged to explore the interconnected nature of environmental, social, and economic considerations, including the trade-offs involved in land-use decisions."
The organizers advised focusing on one geographic area and several specific land-use lessons.

### Official challenge constraints
- Education and engagement are essential.
- Players must understand the consequences of their decisions.
- Environmental consequences must be credible and understandable.
- Simplified, evidence-informed models are allowed if assumptions and limitations are explained.
- Real-world GIS and satellite data are encouraged but not mandatory for the educational prototype.
- A usable product should be achievable with less than three months of further development.
- The product must not be profit-driven.
- Educational impact should be measurable through understanding or intended participation, not merely clicks or gameplay time.
- The core experience should demonstrate a choice, its consequences, and why those consequences matter.

### Our interpretation
We do NOT want to build a game where players merely select from three sustainability options and receive predetermined outcomes.
We want an actual interactive city-building simulation inspired by SimCity, with ecological processes modeled as fundamental systems.
The player develops a landscape. The game simulates the environmental, economic, and community consequences of their actions. The educational insight emerges from playing the game and interacting with these systems.
Our fundamental design principle: The environment should not be a secondary happiness meter. It should be one of the fundamental systems determining whether the player's community succeeds.

## 2. PRODUCT VISION
Name: Amoria. Tagline: Build a city. Shape an ecosystem.

High-level concept: A beautiful, browser-based 3D city-building game where players manage a landscape containing forests, farms, water, hills, and a growing community. Players can develop land, create infrastructure, expand agriculture, restore ecosystems, and experiment with competing strategies. Their choices dynamically affect the environment, economy, and community. The simulation progresses over years. Rainfall, droughts, land degradation, ecological recovery, and development create new challenges. The player can inspect how their decisions affect the region, rewind or compare alternative futures, and learn what makes communities more resilient.

Primary inspiration: SimCity and Cities: Skylines. We want their core city-building interaction model: a world the player can freely modify; roads, land uses, infrastructure, and development; resources and budgets; simulated systems responding to player decisions; a sense of ownership over the settlement; problems emerging from how the player develops the world; tools and overlays for investigating why a problem exists; satisfying visual development and transformation. We are NOT trying to reproduce their scale, proprietary assets, exact interface, or entire simulation complexity. Our differentiator is an ecologically grounded environmental simulation.

Visual direction: Beautiful, polished, stylized 3D. Think of a miniature SimCity with a living landscape. Use an elevated isometric perspective and detailed low-poly or stylized assets. The world should look appealing enough that a young person would enjoy interacting with it even without knowing it is an educational project. Important qualities: attractive terrain with hills and valleys; rivers, lakes, or wetlands; forests, vegetation, agriculture, buildings, and roads; cohesive art direction and materials; soft lighting and atmospheric depth; subtle animations; smooth camera movement; clear visual feedback when the environment changes; visually understandable environmental consequences. Avoid making it look like a corporate environmental dashboard. Avoid a generic green-themed website. The 3D world must be the centerpiece of the application.

## 3. PRODUCT REQUIREMENTS AND GAMEPLAY
Core player fantasy: "You are responsible for developing a region and helping its community prosper while managing the natural systems that make that prosperity possible." The player should feel empowered to experiment. They should not be forced into one predetermined environmentally correct solution. The game should reward understanding relationships, adapting strategies, and managing tradeoffs.

Starting scenario: The game begins with a small settlement in a geographically coherent watershed or valley. The region includes: an existing village or town; a road network or small existing access road; forested land; open grassland; existing agricultural land; hills with varying slopes; a river or drainage system; areas appropriate for development; areas more sensitive to erosion, flooding, or degradation. The community needs adequate housing, food, water, livelihoods, and environmental resilience. The player receives an initial development budget. The long-term objective is to maintain a thriving community over a simulated 20-year horizon. However, the player can continue in sandbox mode.

Core gameplay loop: Observe the landscape and community needs. Select a development or restoration tool. Modify the landscape. Spend resources and incur ongoing costs. Simulate the passage of time. Observe environmental, economic, and community changes. Inspect the causes of new problems or improvements. Adjust the development strategy. Compare outcomes across scenarios. Continue improving the community. The player should always have an interesting decision available.

Interactive tools (with costs and valid placement rules):
- Development: Build or extend roads. Zone or construct residential development. Convert appropriate land into agriculture. Build or improve water infrastructure.
- Environmental management: Clear vegetation where allowed. Reforest or restore vegetation. Introduce agroforestry. Restore wetlands or riparian buffers. Apply a soil-conservation or sustainable-farming intervention.

You may consolidate actions when they represent the same underlying mechanics, but the initial playable game must provide meaningful flexibility. Actions should not be cosmetic. They must modify simulation state and have measurable consequences.

Examples:
- Constructing housing: increases housing capacity; requires upfront resources; changes surface characteristics; may increase demand for water and services; can change runoff characteristics; may produce economic activity over time.
- Expanding conventional agriculture: increases cultivated area; can increase immediate food production; consumes land; may increase water demand; can affect soil condition over time.
- Agroforestry: has upfront establishment costs; may have delayed benefits; can alter erosion risk, vegetation cover, and production characteristics; may provide diversified livelihood opportunities; should have context-dependent benefits and opportunity costs.
- Wetland restoration: uses land and funding; can improve water retention and ecosystem function where appropriate; may reduce available developable area; may reduce some types of downstream runoff or flood exposure depending on the simplified model.

Do not make every sustainable intervention immediately profitable. Do not make every conventional development decision inherently disastrous. Tradeoffs must be real within the game's rules.

## 4. USER INTERFACE AND EXPERIENCE
Landing experience: a polished landing screen with Amoria branding; beautiful 3D landscape or cinematic view; a short, compelling description; primary "Start Building" action; continue saved game, if one exists; short accessible explanation of the purpose; optional instructions. The game should begin quickly without mandatory accounts or lengthy onboarding.

Main game screen: The 3D world occupies the majority of the viewport.
- Top bar: current simulated date/year; money or available budget; population and housing status; food supply or food security; water availability/stress; ecosystem or land-health indicator; community well-being indicator, if meaningfully derived. Keep metrics readable without overcrowding the screen.
- Left toolbar: interactive building and land-management tools. Each action should have a recognizable icon, name, cost, brief description, placement preview, clear valid and invalid placement feedback.
- Right-side inspector: when selecting a parcel or structure, show current land use; terrain characteristics; soil condition or relevant indicator; water-related information; environmental sensitivity; economic role; available interventions; relevant tradeoffs.
- Bottom timeline: pause/play; simulation speed controls; advance by one year or season; current time; timeline or event markers; access to comparison/history mode.
- Additional panels: environmental overlays; budget and economy; community status; scenario comparison; educational insights; settings and help. Panels should be dismissible and should not obscure most of the 3D world.

Camera controls: pan across the landscape; zoom in and out; rotate the camera within sensible limits; maintain an elevated strategic view; reset camera; focus on selected parcel or event. Camera controls must not interfere with placing buildings or editing terrain.

Direct landscape interaction: users must be able to hover over a cell or parcel; see clear selection feedback; click to inspect; select a construction or intervention tool; see a placement preview; apply the action; observe its costs and impacts; use a brush or drag placement where appropriate. Support undo/redo for editing where feasible, and make the consequences of undoing a simulated historical decision clear.

## 5. 3D WORLD ENGINE
Technology preferred: React, TypeScript, Vite, Three.js, React Three Fiber, Drei, Zustand, Tailwind CSS, Lucide icons, Vitest for simulation tests (Playwright overridden: not used). Use React Three Fiber for the 3D scene rather than embedding the entire game inside a giant imperative Three.js component. The rendering system must remain separate from simulation logic.

World representation: use a spatial grid as the authoritative simulation model, approximately 64×64 cells. Each cell represents an actual or abstract area of land, with a documented physical size where real geography is used. (Schema: see src/simulation/types.ts.) Do not make derived values independently mutable if they can be calculated from authoritative state.

Terrain generation: render a terrain mesh based on elevation values. Requirements: actual height variation; smoothed or otherwise visually coherent topology; no obvious gaps between cells; surface materials based on land cover; placement of trees, crops, structures, and vegetation; rivers/water rendered coherently with the topography; cell picking through raycasting or an equivalent mechanism; visually smooth land-use transitions where practical. The simulation grid is authoritative. The renderer reads from the simulation state.

Environmental visual states: the same landscape should visibly transform over time: forest grows or disappears; cropland expands; urban development increases; restoration increases vegetation cover; drought affects crop appearance and vegetation condition; erosion or soil degradation becomes visible in affected areas; wetlands and water features reflect environmental changes; restoration progresses gradually rather than appearing instantly. These visuals should represent changes in simulation state. Do not trigger an irreversible visual animation without the corresponding state change.

Rendering performance: instanced meshes for repeated trees, buildings, crops, and props; reused geometries and materials; controlled draw calls; efficient terrain geometry; avoiding unnecessary React rerenders; separate rendering and simulation update rates; efficient raycasting and interaction; reduced-detail modes where needed. Aim for responsive gameplay on a reasonably modern laptop browser. Use good lighting, shadows, subtle atmospheric effects, and high-quality materials without destroying performance.

3D assets: evaluate CC0/openly reusable asset packs, including https://kenney.nl/assets/nature-kit. You may use reusable 3D assets, procedural geometry, GLTF models, and compatible open-source libraries. Verify licenses and attribution requirements. Do not copy copyrighted game assets. Keep the visual language consistent.

## 6. REAL-WORLD GIS INTEGRATION
Our intended world is not purely fictional. We want a geographically grounded, stylized 3D landscape. However, GIS data acquisition must not block development of the game.
Geographic data to evaluate: ESA WorldCover (https://esa-worldcover.org/en/data-access); Copernicus elevation data (https://dataspace.copernicus.eu/); potentially OpenStreetMap. The hackathon pack also references Trends.Earth, Stanford Natural Capital Alliance / InVEST, FAO Earth Map.
Initial geography: choose one compact real-world region with meaningful elevation differences, agricultural land, vegetation or forest, existing or plausible settlement, a coherent watershed or drainage setting, interesting ecological tradeoffs. Prefer a location with easily accessible data and a well-defined learning scenario. Do not invent geographic provenance.
GIS pipeline: build a reproducible offline preprocessing workflow that downloads or reads the selected geographic datasets; clips them to the chosen region; reprojects into an appropriate local coordinate system if necessary; samples elevation into the simulation grid; aggregates land-cover classes into supported game classes; calculates terrain slope and other relevant derived attributes; validates data completeness; exports a compact JSON/binary representation usable by the browser; records the geographic bounding box, scale, projection, source dates, licenses, and assumptions. Use Python with Rasterio/NumPy or equivalent offline tools. Don't perform heavyweight geospatial raster processing inside the browser game loop.
Data integrity: ESA WorldCover describes observed historical conditions; it does not predict the effects of player actions. Do not represent changes between WorldCover algorithm versions as clean measured changes. Do not imply a satellite pixel is a precise soil-health measurement. If source data is coarser than the game grid, disclose that.
Reliable fallback: a procedurally generated starter landscape clearly labeled as a fictional educational scenario, supporting the complete game if GIS acquisition is blocked. Keep the world loader abstract so the same gameplay works with either world. Once the game works, pursue importing a real geographic region as the default world. Do not claim real data was used unless it actually was.

## 7. ENVIRONMENTAL SIMULATION ENGINE
This is the most important technical subsystem. We are NOT building superficial sustainability scores. We are building simplified interconnected models that produce environmental and economic consequences from the underlying world state. Keep the simulation deterministic for identical initial conditions, player actions, and random seeds. Use explicit model parameters and documented assumptions.
Model architecture: separate land-use dynamics; hydrology and water resources; soil degradation and recovery; vegetation and restoration; food production; economy and development; population and community outcomes; environmental events. All systems interact through well-defined state variables, implemented as independently testable modules.

7.1 Land-use model: each cell has terrain characteristics and a land-cover type. Player decisions convert one land use into another, subject to placement restrictions, resource costs, terrain suitability, existing structures, water features, accessibility where relevant, protected or unavailable land. Land-cover changes influence the hydrological, ecological, and economic models. A forest cell should not behave identically to a paved urban cell.

7.2 Hydrology: a simplified rainfall/runoff/infiltration model. Inputs may include rainfall, land cover, soil condition, soil moisture, slope, water storage, irrigation demand, water-management interventions. Outputs may include infiltration, surface runoff, retained water, available water, water stress, downstream water movement. Where feasible, derive downhill flow directions using elevation (simplified D8). Water should move coherently with the terrain. Avoid artificial mass creation or unexplained water loss. Account for inflows, infiltration, evaporation/other losses, storage, withdrawals, runoff, and outflows. Use documented units and a consistent timestep. Do not present this as a calibrated flood-prediction model.

7.3 Soil and erosion: model degradation risk from terrain slope, rainfall/runoff intensity, vegetation protection, land cover, farming intensity or management, restoration measures. Soil condition evolves over time. Greater protective vegetation cover can reduce erosion susceptibility under otherwise similar conditions; exposed soil on steep slopes can be more vulnerable during heavy rainfall; soil conservation practices can reduce modeled degradation pressure; restoration can gradually improve selected indicators. Don't assume effects are identical everywhere. Represent uncertain effects conservatively. If using a RUSLE-inspired model, document what is borrowed, modified, or omitted. Avoid presenting arbitrary game units as scientifically validated tonnes of soil loss.

7.4 Vegetation and restoration: vegetation evolves with land-use type, time, soil condition, water availability, restoration interventions, disturbances. Restoration requires time and resources. Agroforestry is not instant forest creation. A restored landscape can become more resilient, but outcomes depend on context.

7.5 Agriculture and food: Harvest = cultivated area × potential yield × soil condition factor × water availability factor × management factor × environmental event factor. Use explicit or clearly documented game units. Factors connect to actual simulation state. Crops require land and possibly water, incur costs, and generate food and/or income. Productivity changes as soil and resources evolve. Agricultural expansion and agricultural intensification must be meaningfully different strategies.

7.6 Economy: starting budget; construction costs; restoration costs; maintenance or operating costs; agricultural revenue or economic value; development-related economic activity; resource scarcity; financial tradeoffs over time. No free money; sustainable interventions do not automatically pay for themselves immediately. The player faces financing decisions.

7.7 Community outcomes: a small set of interpretable indicators derived from the actual systems: housing adequacy, food security, water security, livelihood or income, exposure to environmental stress, community well-being. Do not manipulate a happiness score independently. If a composite well-being indicator is displayed, explain the components and weights.

7.8 Weather and environmental events: a deterministic seeded event system: normal rainfall seasons, drought, heavy rainfall, favorable growing periods, longer-term population or development pressure. Critical: a player's land-use choices do not cause an externally scripted drought; they influence how vulnerable or resilient the community is when the same drought occurs. This must hold in the simulation and in the educational explanations.

7.9 Simulation timestep: discrete yearly or seasonal updates with an explicit sequence, e.g.: apply exogenous weather and demographic conditions; calculate water inputs and local retention; route surface runoff; calculate erosion/degradation pressures; update soil and vegetation; calculate agricultural production; calculate economic production, costs, budgets; calculate population needs and community outcomes; generate event and causal explanations; store the snapshot. Avoid hidden double counting.

7.10 Parameters and documentation: a configuration file for environmental coefficients, intervention costs, growth rates, production parameters, water-use parameters, event parameters. Separate evidence-backed relationships from game-balancing assumptions. MODEL_ASSUMPTIONS.md explains every important equation, units, parameter meanings, data sources, what the model can demonstrate, what it cannot reliably predict, known limitations, which parameters are educational approximations. Do not invent citations. Use credible references such as FAO documentation, Stanford InVEST, and published methods where applicable.

## 8. SPATIAL AND EMERGENT CONSEQUENCES
Effects are not confined to the edited parcel. Upstream decisions affect downstream conditions: removing vegetation from a steep upstream parcel increases modeled erosion susceptibility during heavy rainfall; runoff travels downslope; downstream areas may receive increased runoff or sediment pressure; that can affect farmland or development; changes in production and costs affect the economy. Effects must emerge from modeled spatial relationships, never hardcoded ("if user removes three trees, trigger a flood"). Build the first complete implementation around one strong causal chain, then connect additional systems. The game must not depend on a single scripted drought event to function.

## 9. TIME, HISTORY, AND ALTERNATIVE FUTURES
Time controls: pause; resume; advance time; choose simulation speed; review the current year; observe long-term landscape changes. Simulated years should not require sitting through long animations.
Snapshot history: save meaningful snapshots of world and simulation state, enabling reviewing earlier world conditions, tracking important decisions, displaying historical metrics, investigating what caused an outcome.
Counterfactual comparison ("Compare Futures"): compare two strategies on equivalent initial conditions: same initial world, same resources, same exogenous weather sequence/seed, different land-use decisions, visually understandable differences, environmental/economic/community comparisons. At minimum: Save Scenario A; reset or branch to the same starting conditions; play Scenario B; compare outcomes. Support visually comparing landscapes (split-screen, synchronized camera, or before/after slider). The comparison must use simulation snapshots, not predetermined result cards.
Causal explanations: when important changes occur, players can inspect why, e.g. "Your agricultural output fell because soil condition declined and available water was insufficient during the drought." Explanations cite relevant simulated variables; no LLM-generated ungrounded claims; explain both benefits and costs; a player can trace major outcomes back to decisions, model relationships, and exogenous events.

## 10. GAME DESIGN AND EDUCATIONAL EXPERIENCE
Make it genuinely engaging: satisfying construction interactions; beautiful land transformations; meaningful resource constraints; visible community growth; challenges that emerge from the simulation; unexpected but explainable tradeoffs; strategic decisions; feedback that encourages experimentation. The core game works even if the player ignores educational text.
Avoid simplistic messaging: no moral binary where trees are always good, farming always bad, construction always bad, restoration always immediately profitable. Communities have legitimate needs and must balance environmental, social, and economic objectives.
Onboarding: a lightweight interactive tutorial teaching navigation, inspecting a parcel, building/modifying land, seeing costs, advancing time, investigating results. No lengthy mandatory instructions.
Challenges: a primary guided scenario centered on watershed development and long-term resilience. Pressures: population growth and housing demand; food production needs; limited public budget; water scarcity; soil degradation; extreme rainfall events. Transparent objectives and useful feedback, multiple viable strategies, no railroading.
Learning and reflection: the player should discover that land use influences the environment; environmental conditions influence economic productivity; economic decisions can improve or undermine resilience; sustainable land management creates opportunities but entails costs; different stakeholders experience different benefits and burdens; planning choices today can have delayed consequences. Include a concise optional learning reflection near the end of guided play (e.g. What tradeoff did you encounter? Which earlier decision affected the community's response to drought? What would you investigate before making a similar decision in your community?). Do not claim measured behavior change based solely on completion.
Real-world participation: a "Bring It Home" section explaining how young people can learn about local planning proposals; attend or follow public planning discussions; ask questions about water, development, and restoration; compare competing land-use proposals; participate in community environmental initiatives. Do not invent local organizations or meeting schedules.

## 11. SIMULATION DATA VISUALIZATION
Overlays: land cover; elevation and slope; water flow or runoff; soil condition; erosion susceptibility; agricultural productivity; urban development; environmental sensitivity. Overlays recolor or annotate the 3D landscape; switchable without leaving the world; legends and understandable labels.
Charts: time series of food production, water stress, soil condition, budget and income, population and housing, vegetation/forest cover, degradation risk, all from actual simulation history. No fabricated sample data.
Explainability: each metric has a tooltip explaining what it measures, how it's calculated at a high level, what influences it, and whether it's a real observed value, derived indicator, or illustrative model output.

## 12. ARCHITECTURE
Clean modular architecture (see repo layout). The simulation is independent of the renderer (SimulationEngine: applyAction(state, action) → state; step(state) → result). Pure or predictably stateful deterministic core. The renderer subscribes to world state and interpolates visual transitions. UI dispatches actions. No environmental models in React components.
Persistence: local browser saving: new game; save game; continue game; reset scenario; store settings; restore consistent simulation state. localStorage or IndexedDB depending on size. No login.
Extensibility: multiple regions, additional interventions/models, richer economy, educational scenarios, optional collaboration, future scenario editor. Do not overengineer.

## 13. PERFORMANCE, ACCESSIBILITY, AND DEPLOYMENT
Performance: stable and smooth on modern desktop browsers; measure rather than assume; instancing; shared materials; efficient geometry; sensible shadows; cached assets; bounded step cost; reduced-quality mode; avoid blocking the main thread (Web Worker only if profiling shows it is useful).
Accessibility: readable typography; high-contrast controls; tooltips; keyboard interaction where feasible; color-independent overlay cues; reduced-motion accommodations; instructions not relying only on visual symbols. Desktop first with reasonable smaller-screen layouts.
Deployment: statically deployable Vite build; no paid backend or recurring AI API for core gameplay; usable offline after assets load where practical; deployment instructions for Netlify/Vercel/static hosts. No monetization, paid features, or advertising.

## 14. OPEN-SOURCE TOOL AND RESOURCE RESEARCH
Evaluate relevant libraries/asset packs (R3F, three, drei, zustand, Kenney, ESA WorldCover, InVEST, FAO). Choose the smallest reliable set. Use scientific-tool documentation to inform models without embedding heavy systems. Verify version compatibility, provenance, and licensing. Don't fork a large existing game unless it materially helps and the license permits.

## 15. VISUAL QUALITY AND PRODUCT POLISH
This must feel like a real game rather than a hackathon proof of concept. Environmental art: coherent palettes and terrain textures; recognizable natural landmarks; appealing terrain geometry; vegetation at varied heights and densities; a believable settlement; clear river and water features; attractive lighting; distinct day/weather/environmental states; satisfying development and restoration animations.
Interface polish: consistent spacing; professional icons; responsive interactions; smooth hover states; clear construction feedback; helpful contextual tooltips; well-designed empty states; user-friendly errors; attractive loading transitions; thoughtful hierarchy. Avoid excessive panels or generic component-library aesthetics. Game-first, not SaaS-first.
Option C realism (after the full experience works): better terrain materials, vegetation distribution, water shaders, lighting/atmosphere, terrain detail, particles, weather, camera transitions, without hurting frame rate or making illustrative outputs look like validated forecasts.

## 16. IMPLEMENTATION STRATEGY (phases)
0 Inspect/establish project. 1 Playable 3D world (terrain, covers, camera, hover/select, tool palette, a working modification). 2 Core simulation (state, terrain attributes, conversion, hydrology, soil, agriculture, economy, costs, time) with tests. 3 City-building gameplay (construction/zoning, costs, roads/accessibility, housing, agriculture, restoration, infrastructure, budget, community needs, valid placement; several ways to develop). 4 Environmental consequences (cover→infiltration/runoff, slope+vegetation→erosion, soil/water→crops, production→economy/food security, demand→development, restoration→conditions; seeded weather with drought/heavy rain; verify outcomes respond to state). 5 Full game experience (guided scenario, UI, tutorial, time controls, notifications, overlays, inspector, metric explanations, visual transformations, save/load, history snapshots). 6 Alternative futures (snapshotting, branching, equivalent restart, comparison, causal explanations, charts, before/after visuals). 7 Real geography (GIS pipeline, real baseline if accessible, same architecture, fallback intact, accurate labels). 8 Polish and validation (aesthetics, animation, lighting, perf, UX, explanations, errors, a11y, docs, deploy config). 9 Expansion (more regions, scenario selection, interventions, richer models, settlement/road visuals, events, comparison, assessments, terrain realism) only after core is satisfied.

## 17. VERIFICATION AND TESTING REQUIREMENTS
Never declare a feature complete solely because code was written.
Simulation unit tests at minimum: land-use conversion updates authoritative state; construction deducts correct cost and respects invalid placements; resources cannot go negative without an explicit debt/shortage mechanism; no NaN/Infinity; same actions + same seed = identical results; forest→bare on a susceptible slope increases modeled erosion pressure under identical conditions; restoration can reduce degradation pressure over time where conditions support it; changing water availability affects agriculture consistently with the production model; drought affects outcomes through environmental conditions, not arbitrary penalties tied to the chosen action; equivalent scenarios receive identical exogenous events; save/load preserves state; history snapshots consistent with outputs; hydrological bookkeeping obeys the accounting rules; derived metrics match underlying variables. Tests validate general behavior, not only hardcoded outputs.
End-to-end user flows (verified via RTL/store tests per project override): open app; start new game; see the 3D world; navigate camera; select a parcel; place/modify land use; see costs deducted; advance time; see outcomes change; open an overlay; inspect an explanation; save; reload and continue; compare alternative scenarios.
Build verification: typecheck, lint, unit tests, production build. Fix failures before declaring completion.

## 18. DEFINITION OF DONE
Product: playable functional 3D city-builder in the browser; visually attractive and interactive world; free land-use modification; development and restoration have costs and constraints; world evolves over time; environmental, economic, community systems interact; spatial and delayed consequences observable; ecological effects from actual rules; player can recover from bad decisions and try different strategies; at least one coherent learning experience; a way to compare alternative futures; metrics/explanations tied to state; a bridge to real-world land-use understanding.
Engineering: React+TS app runs; 3D rendering works; sim and render decoupled; deterministic sim; persistence works; no critical runtime errors; reasonable performance; unit tests pass; production build succeeds; documentation exists; licenses and model assumptions documented.
Scientific integrity: explainable rules; documented parameters and assumptions; baseline data distinguished from forecasts; simplified results not presented as precise predictions; weather events distinguished from consequences of player decisions; no fabricated citations or misleading GIS provenance.
Quality: coherent, intentional, complete; not unrelated demos stitched together.

## 19. EXECUTION BEHAVIOR
Investigate before coding; don't destroy existing work. Plan briefly, then execute. Decide minor details autonomously. Keep the app working in small verifiable increments. Don't fake functionality (no non-functional buttons, no fabricated results, no hardcoded outcomes, no false claims of success). Use parallelism carefully; avoid concurrent edits to the same files. Maintain docs/PROGRESS.md (completed, incomplete, decisions, known bugs, test results, next steps); keep CLAUDE.md concise. Keep improving until complete. Priority order: working enjoyable interactions; correctly connected simulation; meaningful tradeoffs; responsive compelling 3D world; clear feedback and explanations; save/replay/compare flows; real geography; model sophistication; optional photorealism. The goal is the strongest functional product.

## 20. REQUIRED FINAL DELIVERY
Summary of implemented features; run instructions; build/test status with commands executed; app entry point; description of the environmental models implemented; geographic datasets actually used; complete vs unfinished; known limitations; deployment instructions; strongest next improvements. Do not claim completion unless the definition of done is satisfied.

Vision: Amoria should feel like a miniature SimCity where the player discovers how the natural world, human development, and economic prosperity influence one another. A player should be able to build a thriving community, make damaging decisions, face consequences, restore ecosystems, adapt their strategy, and understand the relationships driving their outcomes. The environmental lessons should emerge from the game systems themselves.
