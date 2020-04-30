import React, {useEffect, useRef, useState} from "react";
import MapGL, {Layer, Marker, Source} from "@urbica/react-map-gl";
import {WebMercatorViewportOptions,} from "viewport-mercator-project";
import "mapbox-gl/dist/mapbox-gl.css";
// eslint-disable-next-line import/no-extraneous-dependencies
import {FeatureCollection} from "geojson";

import {
  allEntrancesLayer,
  allEntrancesSymbolLayer,
  routeImaginaryLineLayer,
  routeLineLayer,
  routePointLayer,
  routePointSymbolLayer,
} from "map-style";
import Pin, {pinAsSVG} from "components/Pin";
import calculatePlan, {geometryToGeoJSON} from "planner";
import {ElementWithCoordinates, queryEntrances} from "overpass";
import {addImageSVG} from "mapbox-utils";
import "App.css";
import "components/PinMarker.css";
import {destinationToLatLng, distance, LatLng} from "utils";

interface State {
  viewport: WebMercatorViewportOptions;
  entrances?: Array<ElementWithCoordinates>;
  route: FeatureCollection;
}

const initialState: State = {
  entrances: [],
  route: geometryToGeoJSON(),
  viewport: {
    latitude: 60.17,
    longitude: 24.941,
    zoom: 15,
    bearing: 0,
    pitch: 0,
  },
};

interface Props {
  viewport: WebMercatorViewportOptions;
  origin?: LatLng;
  onOriginMoved?: (latlng: any) => any;
  destination?: ElementWithCoordinates;
  onDestinationMoved?: (latlng: any) => any;
  onMapClicked?: (event: any, feature: any) => any;
  onMapUpdated?: (map: any) => any;
}

const transformRequest = (originalURL: string): { url: string } => {
  const url = originalURL.replace(
    "https://static.hsldev.com/mapfonts/Klokantech Noto Sans",
    "https://fonts.openmaptiles.org/Klokantech Noto Sans"
  );
  return { url };
};

const GatesolveMap: React.FC<Props> = (props) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null);

  // Install a callback to dynamically create pin icons that our map styles use
  useEffect(() => {
    if (!map.current) {
      return; // No map yet, so nothing to do
    }
    const mapboxgl = map.current.getMap();
    if (props.onMapUpdated) props.onMapUpdated(mapboxgl);
    // FIXME: Unclear why this passed type checking before.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapboxgl?.on("styleimagemissing", ({ id: iconId }: any) => {
      if (!iconId?.startsWith("icon-pin-")) {
        return; // We only know how to generate pin icons
      }
      const [, , size, fill, stroke] = iconId.split("-"); // e.g. icon-pin-48-green-#fff
      const svgData = pinAsSVG(size, `fill: ${fill}; stroke: ${stroke}`);
      addImageSVG(mapboxgl, iconId, svgData, size);
    });

  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  const [state, setState] = useState(initialState);

  useEffect(() => {
    setState(
      (prevState): State => ({ ...prevState, viewport: props.viewport })
    );
  }, [props.viewport]);

  useEffect(() => {
    const { destination } = props;
    if (!destination) return; // Nothing to do yet
    queryEntrances(destination).then((result) => {
      setState(
        (prevState): State => {
          const entrances = result.length ? result : [destination];
          return {
            ...prevState,
            entrances,
          };
        }
      );
    });
  }, [props.destination]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set off routing calculation when inputs change; collect results in state.route
  useEffect(() => {
    const { origin, destination } = props;

    if (!origin || !destination || !state.entrances) {
      return; // Nothing to do yet
    }
    let targets = [] as Array<ElementWithCoordinates>;

    // Try to find the destination among the entrances
    state.entrances.forEach((entrance) => {
      if (!destination) return; // XXX: Typescript needs this
      if (
        destination.type === entrance.type &&
        destination.id === entrance.id
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

    // Don't calculate routes between points more than 200 meters apart
    if (distance(origin, destinationToLatLng(destination)) > 200) return;

    calculatePlan(origin, targets, (geojson) => {
      setState(
        (prevState): State => {
          const extendedGeojson = {
            ...geojson,
            features: geojson.features.concat(prevState.route.features),
          };
          return {
            ...prevState,
            route: extendedGeojson,
          };
        }
      );
    });
  }, [props.origin, state.entrances]); // eslint-disable-line react-hooks/exhaustive-deps
  // XXX: props.destination is missing above as we need to wait for state.entrances to change as well

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMapClick = (event: any): void => {
    // Inspect the topmost feature under click
    const feature = map.current?.getMap().queryRenderedFeatures(event.point)[0];
    if (props.onMapClicked) props.onMapClicked(event, feature);
  };

  return (
    <MapGL
      ref={map}
      // This is according to the Get Started materials:
      // https://uber.github.io/react-map-gl/docs/get-started/get-started/
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...state.viewport}
      style={{ width: "100%", height: "90%" }}
      mapStyle="https://raw.githubusercontent.com/HSLdevcom/hsl-map-style/master/simple-style.json"
      transformRequest={transformRequest}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onViewportChange={(viewport: any): void => {
        setState((prevState): State => ({ ...prevState, viewport }));
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onHover={(event: any): void => {
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
      onClick={handleMapClick}
      onContextmenu={handleMapClick}
    >
      <Source
        id="osm-qa-tiles"
        type="vector"
        tiles={["https://tile.olmap.org/osm-qa-tiles/{z}/{x}/{y}.pbf"]}
        minzoom={12}
        maxzoom={12}
      >
        <Layer
          source-layer="osm"
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...allEntrancesLayer}
          source="osm-qa-tiles"
        />
        <Layer
          source-layer="osm"
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...allEntrancesSymbolLayer}
          source="osm-qa-tiles"
        />
      </Source>
      <Source id="route" type="geojson" data={state.route}>
        <Layer
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...routeLineLayer}
          source="route"
        />
        <Layer
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...routeImaginaryLineLayer}
          source="route"
        />

        <Layer
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...routePointLayer}
          source="route"
        />
        <Layer
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...routePointSymbolLayer}
          source="route"
        />
      </Source>

      {props.children}

      {props.origin && (
        <Marker
          className="PinMarker"
          draggable={Boolean(props.onOriginMoved)}
          offset={[0, -22.5]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onDragEnd={props.onOriginMoved}
          longitude={props.origin[1]}
          latitude={props.origin[0]}
        >
          <Pin
            dataTestId="origin"
            style={{ fill: "#00afff", stroke: "#fff" }}
          />
        </Marker>
      )}
      {props.destination && (
        <Marker
          className="PinMarker"
          draggable={Boolean(props.onDestinationMoved)}
          offset={[0, -22.5]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onDragEnd={props.onDestinationMoved}
          longitude={props.destination.lon}
          latitude={props.destination.lat}
        >
          <Pin
            dataTestId="destination"
            style={{ fill: "#64be14", stroke: "#fff" }}
          />
        </Marker>
      )}
    </MapGL>
  );
};

export default GatesolveMap;
