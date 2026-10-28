export const TRAVEL_MODES = [
  "DRIVE",
  "TRANSIT",
  "WALK",
  "BICYCLE",
  "TWO_WHEELER",
] as const;

export type TravelMode = (typeof TRAVEL_MODES)[number];

export type RouteLocation =
  | { address: string }
  | { lat: number; lng: number }
  | { placeId: string };

export interface ComputeRouteInput {
  origin: RouteLocation;
  destination: RouteLocation;
  travelMode?: TravelMode;
  departureTime?: string;
  computeAlternativeRoutes?: boolean;
  languageCode?: string;
  units?: "METRIC" | "IMPERIAL";
}

export interface ComputeRouteMatrixInput {
  origins: RouteLocation[];
  destinations: RouteLocation[];
  travelMode?: TravelMode;
  departureTime?: string;
}

export interface RouteCoordinates {
  lat: number;
  lng: number;
}

export interface RouteLeg {
  distanceMeters?: number;
  durationSeconds?: number;
  startLocation?: RouteCoordinates;
  endLocation?: RouteCoordinates;
}

export interface RouteResult {
  distanceMeters?: number;
  durationSeconds?: number;
  staticDurationSeconds?: number;
  polyline?: string;
  description?: string;
  warnings?: string[];
  legs?: RouteLeg[];
}

export interface ComputeRouteResult {
  routes: RouteResult[];
}

export interface RouteMatrixStatus {
  code?: number;
  message?: string;
}

export interface RouteMatrixElement {
  originIndex: number;
  destinationIndex: number;
  distanceMeters?: number;
  durationSeconds?: number;
  condition?: string;
  status?: RouteMatrixStatus;
}

export interface ComputeRouteMatrixResult {
  originsCount: number;
  destinationsCount: number;
  elements: RouteMatrixElement[];
  durationsSeconds: Array<Array<number | null>>;
}

export interface TravelModeComparison {
  travelMode: TravelMode;
  available: boolean;
  distanceMeters?: number;
  durationSeconds?: number;
  error?: string;
}

export interface CompareTravelModesResult {
  results: TravelModeComparison[];
}

export interface TravelTimeResult {
  distanceMeters?: number;
  durationSeconds?: number;
  durationMinutes?: number;
}

export interface GoogleLatLng {
  latitude: number;
  longitude: number;
}

export type GoogleWaypoint =
  | { address: string }
  | { placeId: string }
  | { location: { latLng: GoogleLatLng } };

export interface GoogleComputeRoutesRequest {
  origin: GoogleWaypoint;
  destination: GoogleWaypoint;
  travelMode: TravelMode;
  routingPreference?: "TRAFFIC_AWARE";
  departureTime?: string;
  computeAlternativeRoutes?: boolean;
  languageCode?: string;
  units?: "METRIC" | "IMPERIAL";
}

export interface GoogleRouteMatrixOrigin {
  waypoint: GoogleWaypoint;
}

export interface GoogleComputeRouteMatrixRequest {
  origins: GoogleRouteMatrixOrigin[];
  destinations: GoogleRouteMatrixOrigin[];
  travelMode: TravelMode;
  routingPreference?: "TRAFFIC_AWARE";
  departureTime?: string;
}

interface GoogleLocation {
  latLng?: GoogleLatLng;
}

interface GoogleRouteLeg {
  distanceMeters?: number;
  duration?: string;
  startLocation?: GoogleLocation;
  endLocation?: GoogleLocation;
}

interface GoogleRoute {
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  description?: string;
  warnings?: string[];
  legs?: GoogleRouteLeg[];
}

export interface GoogleComputeRoutesResponse {
  routes?: GoogleRoute[];
}

export interface GoogleRouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  distanceMeters?: number;
  duration?: string;
  condition?: string;
  status?: RouteMatrixStatus;
}

export interface GoogleErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}
