import { z } from 'zod'

export const MarketplaceSourceSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('github'),
    repo: z.string().min(3),
    ref: z.string().optional(),
    path: z.string().optional(),
  }),
  z.strictObject({
    source: z.literal('git'),
    url: z.string().min(3),
    ref: z.string().optional(),
    path: z.string().optional(),
  }),
  z.strictObject({
    source: z.literal('url'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.strictObject({
    source: z.literal('npm'),
    package: z.string().min(1),
  }),
  z.strictObject({
    source: z.literal('file'),
    path: z.string().min(1),
  }),
  z.strictObject({
    source: z.literal('directory'),
    path: z.string().min(1),
  }),
])

export type MarketplaceSource = z.infer<typeof MarketplaceSourceSchema>

const MarketplacePathListSchema = z.preprocess(value => {
  if (typeof value === 'string') return [value]
  return value
}, z.array(z.string()))

const MarketplacePluginSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    source: z.string().optional().default('./'),
    strict: z.boolean().optional(),
    skills: MarketplacePathListSchema.optional(),
    commands: MarketplacePathListSchema.optional(),
  })
  .passthrough()

export const MarketplaceManifestSchema = z
  .object({
    $schema: z.string().optional(),
    description: z.string().optional(),
    name: z.string().min(1),
    owner: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
      })
      .passthrough()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
    plugins: z.array(MarketplacePluginSchema).default([]),
  })
  .passthrough()

export type MarketplaceManifest = z.infer<typeof MarketplaceManifestSchema>
export type PluginEntry = MarketplaceManifest['plugins'][number]

export const KnownMarketplacesSchema = z.record(
  z.string(),
  z.strictObject({
    source: MarketplaceSourceSchema,
    installLocation: z.string().min(1),
    lastUpdated: z.string().min(1),
    autoUpdate: z.boolean().optional(),
  }),
)

export type KnownMarketplacesConfig = z.infer<typeof KnownMarketplacesSchema>

export type PluginScope = 'user' | 'project' | 'local'
