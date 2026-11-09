# Model catalog

The catalog combines model prices, billing units, and capabilities.
An invalid revision never replaces the active one, so applications continue receiving the last validated snapshot.

The format is defined by the [schema and validator](../src/catalog-schemas.js); initial entries are available in the
[example catalog](../catalog.example.yaml).
The server settings specify the working file, which must remain separate from source files replaced during updates.

An entry can contain a model description or a string naming another entry exactly.
A string reference is an alternative name for the same pricing record; YAML aliases are not allowed.
An unknown target or reference cycle invalidates the entire revision.

Lookup first checks the full name. If it is missing, lookup removes the prefix through the first @ and checks the rest.
Slashes and trailing dates are not removed automatically; such names require explicit entries.
Responses preserve the requested, matched, and canonical names to explain the selected price.

Prices and supported modes are described separately.
Matching rates do not imply mode support, and an unknown rate differs from a confirmed zero.
Billing units are explicit; minutes, characters, images, and video seconds cannot be treated as text usage.

The server loads the catalog and access settings from config/local.yaml before opening its port.
File changes apply as a fully validated snapshot; failures and recovery are logged.
The content version is independent of property order, and each batch response uses a single version.

Insufficient evidence is stored alongside the model description.
It does not prevent access to the original values or a conditional calculation, but explains the result's limitations.
The `evidence` object contains `status` (`confirmed` or `insufficient`) and a `sources` array, without a `reason` field.
Calculations with `insufficient` evidence include a general notice and remain qualified even when all rates are known.
