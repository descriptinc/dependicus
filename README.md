# Dependicus

_Make informed decisions about your JavaScript dependency graph, at an organizational scale._

Do you ever find yourself wishing you could see a big table of every dependency in every package in your monorepo? Or automatically create tickets in Linear for dependency upgrades, with lots of detail and with a due date that reflects the needs and realities of your engineering organization? Do you use pnpm or Linear?

If you answered "yes" to any of these questions, Dependicus could be for you!

## What is Dependicus?

Dependicus scrapes a bunch of data sources—package.json, pnpm workspaces, npmjs.org, even GitHub—and saves it in a massive JSON file. Then, it can build a static site to give you actionable visibility into your dependency graph like you've never had before. And it can create and update tickets in Linear in an incredibly customizeable way. It takes tens of minutes to collect information about hundreds of packages (assuming you’re lucky enough to have hundreds of dependencies), and then you get to browse it at your own speed instead of waiting for API calls.

Dependicus is a static site generator for your `pnpm-lock.yaml` that can directly link to individual releases and changelogs on npmjs.org and GitHub.

Dependicus is a ticket-creation bot that you can customize to only bother you when you really want it to, and make precisely the correct amount of noise.

Dependicus is our best attempt at a tool that lets you make informed decisions about your JavaScript dependency graph.

TODO: Large screenshot here

TODO: Link the Dependicus of Dependicus

## How do I start using Dependicus?

The simplest way to experience Dependicus is to run this command at the root of a pnpm-powered codebase:

```
npx dependicus@latest update --html
```

!!!note
    Setting `$GITHUB_TOKEN` will significantly speed up GitHub metadata fetching.

After running this command, you'll have a static site under `./dependicus-out/`, as well as a JSON representation at `./dependicus-out/dependencies.json`.

If you want to demo creating Linear tickets, you can set the `LINEAR_API_KEY` env var and then run this command to see what Linear tickets would be created based on the JSON:

```
npx dependicus@latest make-linear-tickets --linear-team-id=<uuid of a Linear team>
```

If you like what you see, then you can add `dependicus` to your `package.json` and do one of two things:

1. Invoke it on the command line with `pnpm exec dependicus` and get the output you’ve been seeing.
2. Customize by writing your own CLI wrapper. Add extra columns to the table or customize the Linear behavior.

## AI nutrition label

| Item | Status |
|------|--------|
| 🤖#️⃣ Contains code written by agents | ✅ |
| 🤖📄 Contains docs written by agents | ❌ |
| 🧑🏻‍💻🧑🏻‍💻 Human code review | ✅ |

## Contributing

We accept contributions exclusively in the form of discussions on GitHub. Some topics we are curious about include:

- Are there bugs? We don't think so, but are there?
- What’s the urgency of adding support for other package managers, like yarn, bun, or regular npm?
- Does anyone else assign teams to own dependencies and route Linear tickets accordingly, like we do at Descript? Should we include a way to do that?
- Is the HTML output ugly? If so, what would make it better?
- Is there a valuable data source we should add to enrich dependency metadata?

If you have something to say about these topics, head on over to the Discussions tab and let us know!
