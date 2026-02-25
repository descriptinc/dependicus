# You can use coding agents to update dependencies

Upgrading a dependency is often more complicated than just bumping the version number in a file. When your least favorite dependency makes its 10th breaking change this year, the version bump is the least of your concerns.

That’s why Dependicus opens tickets instead of PRs. But you can still keep the convenience of automatic PRs by assigning Dependicus’s tickets directly to coding agents like Claude, Cursor, Codex, or Copilot. The tickets created by Dependicus, [like this one](https://github.com/descriptinc/dependicus/issues/4), contain enough context for an agent to do a good job, including writing a good PR title and description. And if you know an upgrade must include a hard-to-predict change, or comes with a gotcha, you can comment on the ticket, and the agent will see the extra context.

Agents can be prompted to run your linter, typechecker, and test suite locally before sending you code to review, and they can notice that several packages need to be updated together.
