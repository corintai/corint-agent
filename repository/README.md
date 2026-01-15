# Repository Assets

This folder contains business configuration and knowledge assets for CORINT.

## Layout
- `datasource.yaml` Data source definitions
- `knowledge/` Domain knowledge base

## Data source format
`datasource.yaml` supports a map or a list under `datasource`, `data_sources`, or `datasources`:

```yaml
datasource:
  postgres_main:
    provider: postgresql
    connection_string: "postgresql://user:password@localhost:5432/corint_rules"
    options:
      max_connections: "5"
```

## Notes
- Secrets can be stored directly in YAML, or referenced via `${ENV_VAR}`.
- The agent resolves `repository/datasource.yaml` by searching upwards from the current working directory.
