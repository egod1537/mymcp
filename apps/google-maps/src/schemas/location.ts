import { z } from 'zod';

const languageCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'language_code must be a BCP-47 language tag.');

const regionCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'region_code must contain exactly two letters.');

export const locationBiasSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90).describe('Bias-circle latitude'),
    longitude: z.number().finite().min(-180).max(180).describe('Bias-circle longitude'),
    radius_meters: z
      .number()
      .finite()
      .min(1)
      .max(50_000)
      .describe('Soft bias radius from 1 through 50000 metres'),
  })
  .strict();

export const resolveLocationInputSchema = z
  .object({
    query: z.string().trim().min(1).max(250).describe('Place name or street address to identify'),
    query_type: z
      .enum(['place', 'address'])
      .default('place')
      .describe('Use place for POIs/names and address for structured street addresses'),
    language_code: languageCodeSchema
      .default('ko')
      .describe('BCP-47 response language; defaults to ko'),
    region_code: regionCodeSchema
      .optional()
      .describe('Optional two-letter regional hint such as jp'),
    location_bias: locationBiasSchema
      .optional()
      .describe('Optional soft circular bias for place searches only'),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.query_type === 'address' && input.location_bias !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['location_bias'],
        message:
          'location_bias is not supported with query_type address; remove the bias or use query_type place.',
      });
    }
  });

export type ResolveLocationInput = z.infer<typeof resolveLocationInputSchema>;

export interface LocationCandidate {
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  latitude: number;
  longitude: number;
  precision: string | null;
  partial_match: boolean;
}

export interface ResolveLocationResult {
  status: 'ok' | 'no_results';
  query: string;
  query_type: 'place' | 'address';
  source: 'google_places_text_search' | 'google_geocoding';
  candidates: LocationCandidate[];
  needs_disambiguation: boolean;
  attribution: 'Google Maps';
}
