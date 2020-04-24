import React, { useState, useEffect, useRef } from "react";
import { useRouteMatch, useHistory } from "react-router-dom";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { match } from "react-router-dom";
import MapGL, {
  Source,
  Layer,
  WebMercatorViewport,
  GeolocateControl,
  ViewportProps,
  MapRequest,
} from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
// eslint-disable-next-line import/no-extraneous-dependencies
import { FeatureCollection } from "geojson";
import { ReactAutosuggestGeocoder } from "react-autosuggest-geocoder";

import {
  routePointLayer,
  routePointSymbolLayer,
  routeLineLayer,
  allEntrancesLayer,
  allEntrancesSymbolLayer,
  routableTilesLayer,
} from "./map-style";
import PinMarker from "./components/PinMarker";
import { pinAsSVG } from "./components/Pin";
import calculatePlan, { geometryToGeoJSON } from "./planner";
import { queryEntrances, ElementWithCoordinates } from "./overpass";
import { addImageSVG } from "./mapbox-utils";
import routableTilesToGeoJSON from "./RoutableTilesToGeoJSON";
import { getVisibleTiles } from "./minimal-xyz-viewer";

import "./App.css";

interface State {
  viewport: Partial<ViewportProps>;
  origin: [number, number];
  destination: ElementWithCoordinates;
  entrances: Array<ElementWithCoordinates>;
  route: FeatureCollection;
  routableTiles: Map<string, FeatureCollection | null>;
}

const latLngToDestination = (
  latLng: [number, number]
): ElementWithCoordinates => ({
  id: -1,
  type: "node",
  lat: latLng[0],
  lon: latLng[1],
});

const initialOrigin: [number, number] = [60.16295, 24.93071];
const initialDestination: ElementWithCoordinates = latLngToDestination([
  60.16259,
  24.93155,
]);
const initialState: State = {
  origin: initialOrigin,
  destination: initialDestination,
  entrances: [],
  route: geometryToGeoJSON(),
  viewport: {
    latitude: 60.163,
    longitude: 24.931,
    zoom: 16,
    bearing: 0,
    pitch: 0,
  },
  routableTiles: new Map(),
};

const transformRequest = (originalURL?: string): MapRequest => {
  if (!originalURL) {
    throw Error("This cannot happen as URL isn't actually optional.");
  }
  const url = originalURL.replace(
    "https://static.hsldev.com/mapfonts/Klokantech Noto Sans",
    "https://fonts.openmaptiles.org/Klokantech Noto Sans"
  );
  return { url };
};

const parseLatLng = (text: string): [number, number] =>
  text.split(",").map(Number) as [number, number];

const fitBounds = (
  viewportProps: Partial<ViewportProps>,
  latLngs: Array<[number, number]>
): Partial<ViewportProps> => {
  const viewport = new WebMercatorViewport(viewportProps);
  const minLng = Math.min(...latLngs.map((x) => x[1]));
  const maxLng = Math.max(...latLngs.map((x) => x[1]));
  const minLat = Math.min(...latLngs.map((x) => x[0]));
  const maxLat = Math.max(...latLngs.map((x) => x[0]));
  const padding = 20;
  const markerSize = 50;
  const occludedTop = 40;
  const circleRadius = 5;
  return viewport.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    {
      padding: {
        top: padding + occludedTop + markerSize,
        bottom: padding + circleRadius,
        left: padding + markerSize / 2,
        right: padding + markerSize / 2,
      },
    }
  );
};

const App: React.FC = () => {
  const map = useRef<MapGL>(null);
  const mapViewport = useRef<Partial<ViewportProps>>({});
  const geolocationTimestamp = useRef<number | null>(null);

  // Install a callback to dynamically create pin icons that our map styles use
  useEffect(() => {
    if (!map.current) {
      return; // No map yet, so nothing to do
    }
    const mapboxgl = map.current.getMap();
    mapboxgl?.on("styleimagemissing", ({ id: iconId }) => {
      if (!iconId.startsWith("icon-pin-")) {
        return; // We only know how to generate pin icons
      }
      const [, , size, fill, stroke] = iconId.split("-"); // e.g. icon-pin-48-green-#fff
      const svgData = pinAsSVG(size, `fill: ${fill}; stroke: ${stroke}`);
      addImageSVG(mapboxgl, iconId, svgData, size);
    });
  }, [map]);

  const urlMatch = useRouteMatch({
    path: "/route/:from/:to",
  }) as match<{ from: string; to: string }>;

  const [state, setState] = useState(initialState);

  useEffect(() => {
    if (
      !state.viewport.zoom ||
      !state.viewport.width ||
      !state.viewport.height
    ) {
      return; // Nothing to do yet
    }
    if (state.viewport.zoom < 12) return; // minzoom

    // Calculate multiplier for under- or over-zoom
    const tilesetZoomLevel = 14;
    const zoomOffset = 1; // tiles are 512px (double the standard size)
    const zoomMultiplier =
      2 ** (tilesetZoomLevel - zoomOffset - state.viewport.zoom);

    const visibleTiles = getVisibleTiles(
      zoomMultiplier * state.viewport.width,
      zoomMultiplier * state.viewport.height,
      [state.viewport.longitude, state.viewport.latitude],
      tilesetZoomLevel
    );

    // Initialise the new Map with nulls and available tiles from previous
    const routableTiles = new Map();
    visibleTiles.forEach(({ zoom, x, y }) => {
      const key = `${zoom}/${x}/${y}`;
      routableTiles.set(key, state.routableTiles.get(key) || null);
    });

    setState(
      (prevState: State): State => {
        return {
          ...prevState,
          routableTiles,
        };
      }
    );

    visibleTiles.map(async ({ zoom, x, y }) => {
      const key = `${zoom}/${x}/${y}`;
      if (routableTiles.get(key) !== null) return; // We already have the tile
      // Fetch the tile
      const response = await fetch(
        `https://tile.olmap.org/routable-tiles/${zoom}/${x}/${y}`
      );
      const body = await response.json();
      // Convert the tile to GeoJSON
      const geoJSON = routableTilesToGeoJSON(body) as FeatureCollection;
      // Add the tile if still needed based on latest state
      setState(
        (prevState: State): State => {
          if (prevState.routableTiles.get(key) !== null) {
            return prevState; // This tile is not needed anymore
          }
          const newRoutableTiles = new Map(prevState.routableTiles);
          newRoutableTiles.set(key, geoJSON);
          return {
            ...prevState,
            routableTiles: newRoutableTiles,
          };
        }
      );
    });
  }, [state.viewport]); // eslint-disable-line react-hooks/exhaustive-deps
  // XXX: state.routableTiles is missing above as we only use it as a cache here

  useEffect(() => {
    if (urlMatch) {
      const origin = parseLatLng(urlMatch.params.from);
      const destination = parseLatLng(urlMatch.params.to);
      const viewport = fitBounds(mapViewport.current, [origin, destination]);
      setState(
        (prevState): State => ({
          ...prevState,
          origin,
          destination: latLngToDestination(destination),
          viewport: { ...mapViewport.current, ...viewport },
        })
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const history = useHistory();

  useEffect(() => {
    const destination = [state.destination.lat, state.destination.lon];
    if (
      history.location.pathname !== `/route/${state.origin}/${destination}/`
    ) {
      history.replace(`/route/${state.origin}/${destination}/`);
    }
  }, [history, state.origin, state.destination]);

  useEffect(() => {
    queryEntrances(state.destination).then((result) => {
      setState(
        (prevState): State => {
          if (prevState.destination !== state.destination) {
            return prevState;
          }
          const entrances = result.length ? result : [state.destination];

          return {
            ...prevState,
            entrances,
          };
        }
      );
    });
  }, [state.destination]);

  // Set off routing calculation when inputs change; collect results in state.route
  useEffect(() => {
    let targets = [] as Array<ElementWithCoordinates>;

    // Try to find the destination among the entrances
    state.entrances.forEach((entrance) => {
      if (
        state.destination.type === entrance.type &&
        state.destination.id === entrance.id
      ) {
        targets = [entrance];
      }
    });

    // If the destination entrance wasn't found, route to all entrances
    if (!targets.length) {
      targets = state.entrances;
    }

    // Clear previous routing results by setting an empty result set
    setState(
      (prevState): State => ({
        ...prevState,
        route: geometryToGeoJSON(),
      })
    );

    calculatePlan(state.origin, targets, (geojson) => {
      setState(
        (prevState): State => {
          // don't use the result if the parameters changed meanwhile
          if (
            state.origin !== prevState.origin ||
            state.entrances !== prevState.entrances ||
            state.destination !== prevState.destination
          ) {
            return prevState;
          }
          geojson.features.push(...prevState.route.features);
          return {
            ...prevState,
            route: geojson,
          };
        }
      );
    });
  }, [state.origin, state.entrances]); // eslint-disable-line react-hooks/exhaustive-deps
  // XXX: state.destination is missing above as we need to wait for state.entrances to change as well

  return (
    <div data-testid="app" className="App">
      <header className="App-header">
        <h2>Gatesolve</h2>
      </header>
      <ReactAutosuggestGeocoder
        url="https://api.digitransit.fi/geocoding/v1/"
        sources="oa,osm,nlsfi"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSuggestionSelected={(event: any, { suggestion }: any): any => {
          const { origin } = state;
          const destination = [
            suggestion.geometry.coordinates[1],
            suggestion.geometry.coordinates[0],
          ] as [number, number];
          const viewport = fitBounds(mapViewport.current, [
            origin,
            destination,
          ]);
          const [type, id] = suggestion.properties.source_id.split(":");
          setState(
            (prevState): State => ({
              ...prevState,
              origin,
              destination: {
                lat: destination[0],
                lon: destination[1],
                type,
                id: Number(id),
              },
              entrances: [],
              viewport: { ...mapViewport.current, ...viewport },
            })
          );
        }}
      />
      <MapGL
        ref={map}
        // This is according to the Get Started materials:
        // https://uber.github.io/react-map-gl/docs/get-started/get-started/
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...state.viewport}
        width="100%"
        height="90%"
        mapStyle="https://raw.githubusercontent.com/HSLdevcom/hsl-map-style/master/simple-style.json"
        transformRequest={transformRequest}
        onViewportChange={(viewport): void => {
          mapViewport.current = viewport;
          setState((prevState): State => ({ ...prevState, viewport }));
        }}
        onHover={(event): void => {
          // Inspect the topmost feature under click
          const feature = event.features?.[0];
          // Set cursor shape depending whether we would click an entrance
          const cursor = feature?.properties.entrance ? "pointer" : "grab";
          // FIXME: Better way to set the pointer shape or at least find the element
          const mapboxOverlaysElement = document.querySelector(
            ".overlays"
          ) as HTMLElement;
          if (mapboxOverlaysElement) {
            mapboxOverlaysElement.style.cursor = cursor;
          }
        }}
        onClick={(event): void => {
          if (
            // Filter out events not caused by left mouse button
            event.srcEvent.button !== 0 ||
            // FIXME GeolocateControl lets clicks through
            event.target.className === "mapboxgl-ctrl-icon" ||
            // FIXME Attribution lets clicks through
            event.target.className ===
              "mapboxgl-ctrl mapboxgl-ctrl-attrib mapboxgl-compact"
          ) {
            return;
          }

          // Inspect the topmost feature under click
          const feature = event.features[0];
          if (feature?.properties.entrance) {
            // If an entrance was clicked, set it as the destination
            setState(
              (prevState): State => ({
                ...prevState,
                destination: {
                  id: feature.properties["@id"],
                  type: feature.properties["@type"],
                  lat: feature.geometry.coordinates[1],
                  lon: feature.geometry.coordinates[0],
                },
              })
            );
          } else {
            // As a fallback, set the clicked coordinates as the destination
            setState(
              (prevState): State => ({
                ...prevState,
                destination: latLngToDestination([
                  event.lngLat[1],
                  event.lngLat[0],
                ]),
              })
            );
          }
        }}
        onContextMenu={(event): void => {
          setState(
            (prevState): State => ({
              ...prevState,
              origin: [event.lngLat[1], event.lngLat[0]],
            })
          );
          event.srcEvent.preventDefault();
        }}
      >
        <GeolocateControl
          className="mapboxgl-ctrl-bottom-left"
          positionOptions={{ enableHighAccuracy: true }}
          trackUserLocation
          // FIXME: The type is wrong in @types/react-map-gl
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onGeolocate={(geolocationPosition: any): void => {
            if (
              geolocationTimestamp.current === null ||
              geolocationPosition.timestamp - geolocationTimestamp.current >
                10000
            ) {
              geolocationTimestamp.current = geolocationPosition.timestamp;
              setState(
                (prevState): State => ({
                  ...prevState,
                  origin: [
                    geolocationPosition.coords.latitude,
                    geolocationPosition.coords.longitude,
                  ],
                })
              );
            }
          }}
        />
        {Array.from(
          state.routableTiles.entries(),
          ([coords, tile]) =>
            tile && (
              <Source
                key={coords}
                id={`source-${coords}`}
                type="geojson"
                data={tile}
              >
                <Layer
                  // eslint-disable-next-line react/jsx-props-no-spreading
                  {...routableTilesLayer}
                  id={coords}
                />
              </Source>
            )
        )}
        <Source
          id="osm-qa-tiles"
          type="vector"
          tiles={["https://tile.olmap.org/osm-qa-tiles/{z}/{x}/{y}.pbf"]}
          minzoom={12}
          maxzoom={12}
        >
          <Layer
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...allEntrancesLayer}
          />
          <Layer
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...allEntrancesSymbolLayer}
          />
        </Source>
        <Source type="geojson" data={state.route}>
          <Layer
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...routeLineLayer}
          />
          <Layer
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...routePointLayer}
          />
          <Layer
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...routePointSymbolLayer}
          />
        </Source>

        <PinMarker
          marker={{
            draggable: true,
            onDragEnd: (event): void => {
              setState(
                (prevState): State => ({
                  ...prevState,
                  origin: [event.lngLat[1], event.lngLat[0]],
                })
              );
            },
            longitude: state.origin[1],
            latitude: state.origin[0],
          }}
          pin={{
            dataTestId: "origin",
            style: { fill: "#00afff", stroke: "#fff" },
          }}
        />
        <PinMarker
          marker={{
            draggable: true,
            onDragEnd: (event): void => {
              setState(
                (prevState): State => ({
                  ...prevState,
                  destination: latLngToDestination([
                    event.lngLat[1],
                    event.lngLat[0],
                  ]),
                })
              );
            },
            longitude: state.destination.lon,
            latitude: state.destination.lat,
          }}
          pin={{
            dataTestId: "destination",
            style: { fill: "#64be14", stroke: "#fff" },
          }}
        />
      </MapGL>
    </div>
  );
};

export default App;
