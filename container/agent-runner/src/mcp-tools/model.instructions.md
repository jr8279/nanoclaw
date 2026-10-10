## Switching models

**`switch_model`** changes the Claude model you run on (fable, opus, sonnet, haiku, or `default`), live, with no restart. Every switch names who it is for:

- `initiated_by: "user"`: the user explicitly asked for a model or to go back to the default. It stays until they change it. Confirm briefly which model you moved to.
- `initiated_by: "self"`: your own choice for the work in front of you. Only make one if your standing instructions give you a model-routing policy; with no such policy, never switch on your own, because model choice sets the user's token spend. A self switch may only pick opus, haiku or default, reverts to the default by itself once the work goes quiet or a task run ends, and opus is capped per day by the tool. If the tool refuses, stay on the current model.
