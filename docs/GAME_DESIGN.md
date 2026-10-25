# Game design

## The idea

The environment is not a happiness meter in Amoria. It is one of the systems that decides whether the town succeeds. Soil that washes off a hillside means a smaller harvest next year, which means less food and less tax income. A cleared catchment sends a bigger flood toward the houses at the bottom. A reservoir dug in year 3 is what keeps taps running in the drought of year 8. The lessons come from playing, not from text, and the game still works if a player reads none of it.

There is no right answer and no moral binary. Trees are not always good, farms are not always bad, building is not always harmful, and restoration costs money long before it pays back.

## The loop

1. **Look.** Read the valley: slopes, streams, soil, where people live and what they need. Overlays and the inspector show what the surface hides.
2. **Choose a tool** and hover the map. Blue tiles mean the change is allowed; orange striped tiles mean it is not, and the status line says why and what it costs.
3. **Change the land.** Click, drag a brush, or draw a road line. Money is spent up front and many things add upkeep every season.
4. **Let time pass.** Each turn is one season, wet then dry. Step a season at a time or play at speed.
5. **See what happened.** Harvests, budget, population, water, soil and floods move. Toasts flag what matters.
6. **Find out why.** The Insights feed explains each change with the numbers behind it and can point the camera at the place. The inspector breaks a parcel down.
7. **Adjust.** Undo edits made this season, step back through history to see the past, or branch from an earlier season and try a different plan.
8. **Compare futures** side by side or with a before and after slider, on the same seed and weather.

## Tools and their tradeoffs

| Tool | What you get | What it costs |
|---|---|---|
| Road | Access for new homes, farms and markets | Paved ground soaks up less rain, so more runs off; upkeep |
| Housing | Room for more people, workers and tax income | More food and water needed; roofs and paving raise runoff |
| Market | Jobs and steady income | Build cost, upkeep, land that grows nothing |
| Demolish | Frees a parcel for another use | You lose what the structure provided |
| Cropland (low, medium, high intensity, optional irrigation) | Food and farm income from the next harvest | Tilled soil erodes, more on slopes and at high intensity; irrigation draws shared water |
| Farming intensity | Higher: bigger harvests now. Lower: gentler on soil | Higher: soil declines faster. Lower: smaller harvests |
| Irrigation | Protects harvests in dry seasons | Uses the water homes rely on; in a drought it can leave less for people |
| Soil conservation (terraces, contour rows) | Less erosion, slowly recovering soil | Up-front cost per field; payoff builds over seasons |
| Agroforestry | Holds soil and water, adds tree products over time | Costs to establish, slow to mature, less food than open fields at first |
| Clear land | Space to develop, a one-off timber sale (the price falls the more you sell) | Removes the cover that protects soil; heavy rain on cleared slopes washes much more away |
| Reforest | Less runoff and erosion as trees mature, steadier water downstream | Costs money, no direct income, land not used for food or homes |
| Restore wetland | Holds back water and traps sediment, easing floods downstream | Takes land out of farming or building; restoration cost |
| Reservoir | Stored wet-season water for the dry season | Expensive; the flooded site is lost to other uses |
| Waterworks | Reliable piped water for the town | Build cost and upkeep |
| Loan and repay | Money now | Interest, and arrears if bills go unpaid |

Placement rules are real: no building in streams, slope limits for housing and fields, reachability for irrigation, a protected ring at the map edge, budget checks for the whole action.

## The guided scenario

Twenty years, two seasons each, on either map. The weather is generated once from the seed and never reacts to the player: a calm start, a guaranteed heavy-rain wet season somewhere in years 3 to 8, and a guaranteed three-season drought starting in a wet season of years 6 to 11. Pressures build together: population and housing demand grow, people need food and water, the public budget is limited, soil can degrade, and extreme rain arrives.

Eleven objectives, all visible from the start in the Goals panel, each with a live value and target:

- Homes for everyone, A growing town, Food grown here (all of the town's food need grown in the valley; bought food does not count), Safe water at home, A good place to live (wellbeing at least 0.9 with no part below 0.8)
- Healthier land (soil health better than the starting village would have in the same weather), Keep the valley green, Hold the soil on the hills (erosion over the last 10 years against the twin)
- A solvent budget
- Ready for drought (food and water in the most recent drought), Homes out of the floodwater (no home floods, or at most 0.9 of the twin's flooded homes)

The food, water, budget and wellbeing goals average the non-drought seasons of the last 3 years, so a drought does not fail them and a player can recover from an early mistake; the drought goal judges those seasons instead. Flood, erosion and land goals are measured against a business-as-usual twin: the starting village run through the same weather. That makes them fair, since a bad storm year does not count against you, only how your choices changed its effect.

The goals pull against each other on purpose. Scripted strategy bots in the test suite play whole games and confirm that every goal can be met by some strategy, that no strategy meets all eleven, and that no strategy is best at everything. Clearing and intensive farming feed people quickly and then pay for it in soil, floods and debt; restoration costs early and pays later; a drought-ready plan needs water storage, not just more fields.

## Onboarding

A short interactive tutorial that advances when the player does the thing, not when they click Next: look around, inspect a parcel, build something, check the cost, let a season pass, find out why. It can be skipped and reopened from Settings and help.

## The end

At the end of the scenario the report shows how each goal turned out, which decisions mattered, how the town came through its worst drought and floods, and what was earned and spent. Then come two optional parts:

- **Reflection.** Three questions: what tradeoff did you run into, which earlier decision affected how the community coped with drought, and what would you look into before a similar decision in your own community. Answers are saved locally for that run only. The game does not claim any change in behavior from completing them.
- **Bring It Home.** Plain suggestions for taking this into real life: find out about planning proposals where you live, follow or attend public planning discussions, ask questions about water, development and restoration, compare competing land-use proposals, and join community environmental work. It names no organizations or meeting dates, because we cannot vouch for any.

## Learning goals

By playing, a player should come to see that:

1. Land use shapes the environment: cover controls how rain soaks in or runs off, and slope plus bare soil controls erosion.
2. Environmental conditions shape the economy: soil and water set harvests, and harvests set food security and income.
3. Economic decisions can build or undermine resilience: a quick timber sale or intensive farming can leave the town weaker for the next drought.
4. Sustainable land management creates real opportunities (steadier harvests, tree income, safer homes) but has real costs and delays.
5. Different people carry different burdens: households downstream flood, farmers on worn hillsides lose yield, the budget carries upkeep.
6. Choices made today have consequences years later, which is why the history view and Compare Futures exist.

Measurement fits the challenge's constraint: understanding and intended participation, not clicks. The reflection answers and the Bring It Home section are where that shows, and nothing is reported anywhere.

## Honesty

Model outputs are illustrative game units, not predictions for any place. The Kaani map is built from real open data, but its soil, rain and yields are model values. Every metric tooltip says whether a number is observed, derived or a model output. See `docs/MODEL_ASSUMPTIONS.md` and `docs/DATA_SOURCES.md`.
