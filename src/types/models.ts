export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  name: string;
  pinHash: string;
  role: UserRole;
  createdAt: string;
  disabled?: boolean;
}

export interface LineStringGeoJson {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface Route {
  id: string;
  name: string;
  createdBy: string;
  visibility: 'public' | 'private';
  rating?: number | null;
  elevationGainMeters?: number;
  elevationLossMeters?: number;
  participantUserIds?: string[];
  gpxStorage?: GpxStorageRef;
  routeLineGeoJson: LineStringGeoJson;
  createdAt: string;
}

export interface GpxStorageRef {
  provider: 'yadisk' | 'local';
  pathOrUrl: string;
}

export interface Activity {
  id: string;
  userId: string;
  participantUserIds: string[];
  startedAt: string;
  distanceMeters: number;
  durationSeconds?: number;
  polylineGeoJson: LineStringGeoJson;
  gpxStorage: GpxStorageRef;
  routeId: string | null;
  createdAt: string;
}

export interface DataFile {
  version: number;
  updatedAt: string;
  users: User[];
  routes: Route[];
  activities: Activity[];
}
