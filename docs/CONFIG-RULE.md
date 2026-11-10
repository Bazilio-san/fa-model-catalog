# Property ordering in YAML files

These rules apply to every `.yaml` and `.yml` file anywhere in the project, including nested directories.
Whenever properties are added, changed, or renamed, order mapping keys alphabetically at each nesting level.
Treat all properties in a mapping as one ordered group, and order each nested mapping independently.

Compare property names character by character, ignoring case: `database` precedes `defaultRows`, and
`maxResultBytes` precedes `maxRows`. Move comments above a property together with that property.
Order mapping properties only. Preserve sequence item order, including when ordering properties within sequence items.

## Exceptions

- Place `enabled` first at its level, followed by the remaining properties in alphabetical order.
- In a `model` section, place `tiers` first, followed by the remaining properties in alphabetical order.
- When properties whose names start with `user` and `password` occur at the same level, place the username
  immediately before the password, at the password's alphabetical position. Examples of username properties
  include `user` and `username`.
- For database connection settings, use the following order, followed by other settings alphabetically:

  ```yaml
  database: placeholder
  host: placeholder
  port: placeholder
  user: placeholder
  password: placeholder
  ```
