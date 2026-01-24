# Config Directory

This directory contains configuration files for CORINT Agent.

## Files

- `datasource.yaml` - Data source definitions

## Data Source Format

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
- The agent resolves `config/datasource.yaml` by searching upwards from the current working directory.
