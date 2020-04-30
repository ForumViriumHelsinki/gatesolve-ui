import {ElementWithCoordinates} from "overpass";
import {distance as turfDistance} from "@turf/turf";

export type LatLng = [number, number];

export const destinationToLatLng = (
  destination: ElementWithCoordinates
): LatLng => [destination.lat, destination.lon];

export const latLngToDestination = (latLng: LatLng): ElementWithCoordinates => ({
  id: -1,
  type: "node",
  lat: latLng[0],
  lon: latLng[1],
});

export const distance = (from: LatLng, to: LatLng): number =>
  turfDistance([from[1], from[0]], [to[1], to[0]], {units: "metres"});

export const parseLatLng = (text: string | undefined): LatLng | undefined => {
  if (text) {
    const parts = text.split(",");
    if (parts.length === 2 && parts[0].length && parts[1].length) {
      const [lat, lon] = parts.map(Number);
      if (!Number.isNaN(lat) && lon > -90 && lon < 90) {
        return [lat, lon];
      }
    }
  }
  return undefined;
};
