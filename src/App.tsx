import React, {ReactText, useEffect, useState} from "react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {match, useHistory, useRouteMatch} from "react-router-dom";
import {Button, IconButton} from "@material-ui/core";
import {Close as CloseIcon} from "@material-ui/icons";
import {useSnackbar} from "notistack";
import {Marker, Popup} from "@urbica/react-map-gl";
import {WebMercatorViewport, WebMercatorViewportOptions} from "viewport-mercator-project";
import "mapbox-gl/dist/mapbox-gl.css";
// eslint-disable-next-line import/no-extraneous-dependencies
import {ReactAutosuggestGeocoder} from "react-autosuggest-geocoder";
import UserPosition from "./components/UserPosition";
import GeolocateControl from "./components/GeolocateControl";
import {ElementWithCoordinates} from "./overpass";
import {getMapSize} from "./mapbox-utils";
import "./App.css";
import "./components/PinMarker.css";
import {destinationToLatLng, distance, LatLng, latLngToDestination, parseLatLng} from "utils";
import GatesolveMap from "components/GatesolveMap";

interface State {
  viewport: WebMercatorViewportOptions;
  isOriginExplicit: boolean;
  origin?: LatLng;
  destination?: ElementWithCoordinates;
  isGeolocating: boolean;
  geolocationPosition: LatLng | null;
  popupCoordinates: LatLng | null;
  snackbar?: ReactText;
  map?: any;
}

const initialState: State = {
  viewport: {
    latitude: 60.17,
    longitude: 24.941,
    zoom: 15,
    bearing: 0,
    pitch: 0,
  },
  isOriginExplicit: false,
  isGeolocating: false,
  geolocationPosition: null,
  popupCoordinates: null,
};

const metropolitanAreaCenter = [60.17066815612902, 24.941510260105133];

const fitBounds = (
  viewportOptions: WebMercatorViewportOptions,
  latLngs: Array<LatLng | undefined>
): WebMercatorViewportOptions => {
  const viewport = new WebMercatorViewport(viewportOptions);
  const inputs = latLngs.filter((x) => x) as Array<LatLng>;
  if (!inputs.length) return viewportOptions; // Nothing to do
  const minLng = Math.min(...inputs.map((x) => x[1]));
  const maxLng = Math.max(...inputs.map((x) => x[1]));
  const minLat = Math.min(...inputs.map((x) => x[0]));
  const maxLat = Math.max(...inputs.map((x) => x[0]));
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
      maxZoom: 17,
    } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    // XXX above: @types/viewport-mercator-project is missing maxZoom
  );
};

const App: React.FC = () => {
  const urlMatch = useRouteMatch({
    path: "/route/:from?/:to?",
  }) as match<{ from: string; to: string }>;

  const [state, setState] = useState(initialState);

  const fitMap = (
    viewportOptions: WebMercatorViewportOptions,
    latLngs: Array<LatLng | undefined>
  ): WebMercatorViewportOptions => {
    return fitBounds(
      { ...viewportOptions, ...getMapSize(state.map) },
      latLngs
    );
  };

  useEffect(() => {
    /**
     * FIXME: urbica/react-map-gl does not expose fitBounds and its viewport
     * does not include width and height which are required by fitBounds from
     * viewport-mercator-project. This is dirty but seems to work.
     */
    if (!state.map) {
      return; // No map yet, so nothing to do
    }
    const { width, height } = getMapSize(state.map);
    if (
      urlMatch &&
      width != null &&
      width > 0 &&
      height != null &&
      height > 0
    ) {
      const origin = parseLatLng(urlMatch.params.from);
      const destination = parseLatLng(urlMatch.params.to);
      const extendedViewport = { ...state.viewport, width, height };
      const viewport = fitBounds(extendedViewport, [origin, destination]);
      setState(
        (prevState): State => ({
          ...prevState,
          origin,
          isOriginExplicit: origin != null,
          destination: destination && latLngToDestination(destination),
          viewport: { ...prevState.viewport, ...viewport },
        })
      );
    }
  }, [state.map]); // eslint-disable-line react-hooks/exhaustive-deps

  const history = useHistory();

  const snackbarFunctions = useSnackbar();
  // XXX: useSnackbar does not return functions during unit tests
  const enqueueSnackbar = snackbarFunctions?.enqueueSnackbar;
  const closeSnackbar = snackbarFunctions?.closeSnackbar;

  useEffect(() => {
    const destination = state.destination && [
      state.destination.lat,
      state.destination.lon,
    ];
    const path = `/route/${state.origin}/${destination}/`;
    if (history.location.pathname !== path) {
      history.replace(path);
    }
  }, [history, state.origin, state.destination]);

  // Set off routing calculation when inputs change
  useEffect(() => {
    if (state.snackbar) closeSnackbar(state.snackbar);

    if (!state.origin || !state.destination) {
      return; // Nothing to do yet
    }
    // Don't calculate routes between points more than 200 meters apart
    if (distance(state.origin, destinationToLatLng(state.destination)) > 200) {
      const message = state.isOriginExplicit
        ? "Distance too long!"
        : "Routing starts when distance is shorter";
      const snackbar = enqueueSnackbar(message, {
        variant: "warning",
        persist: true,
        anchorOrigin: {
          vertical: "bottom",
          horizontal: "center",
        },
        action: (
          <>
            {state.isOriginExplicit && (
              <Button
                onClick={(): void => {
                  setState(
                    (prevState): State => ({
                      ...prevState,
                      origin: prevState.geolocationPosition || undefined,
                      isOriginExplicit: false,
                      viewport: fitMap(prevState.viewport, [
                        prevState.destination &&
                          destinationToLatLng(prevState.destination),
                      ]),
                    })
                  );
                }}
              >
                Discard origin
              </Button>
            )}
            <Button
              onClick={(): void => {
                setState(
                  (prevState): State => ({
                    ...prevState,
                    destination: undefined,
                    viewport: fitMap(prevState.viewport, [prevState.origin]),
                  })
                );
              }}
            >
              Discard destination
            </Button>
            <Button
              target="_blank"
              rel="noreferrer"
              href={`https://www.google.com/maps/dir/?api=1&origin=${state.origin[0]},${state.origin[1]}&destination=${state.destination.lat},${state.destination.lon}`}
            >
              Google Maps
            </Button>

            <IconButton
              aria-label="close"
              onClick={(): void => closeSnackbar(snackbar)}
            >
              <CloseIcon />
            </IconButton>
          </>
        ),
      });
      setState((prevState): State => ({ ...prevState, snackbar }));
      return;
    }
  }, [state.origin, state.destination]); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMapClick = (event: any, feature: any): void => {
    setState(
      (prevState): State => {
        if (feature?.properties.entrance) {
          // If an entrance was clicked, set it as the destination
          return {
            ...prevState,
            destination: {
              id: feature.properties["@id"],
              type: feature.properties["@type"],
              lat: feature.geometry.coordinates[1],
              lon: feature.geometry.coordinates[0],
            },
          };
        }
        // As a fallback, open a popup.
        return {
          ...prevState,
          popupCoordinates: [event.lngLat.lat, event.lngLat.lng],
        };
      }
    );
  };

  /**
   * Two tasks:
   * - update geolocation position into state
   * - change origin if deemed appropriate
   */
  const onGeolocate = (position: Position): void =>
    setState(
      (prevState): State => {
        if (prevState.isGeolocating) {
          const isFirstPosition = prevState.geolocationPosition == null;
          const geolocationPosition: LatLng = [
            position.coords.latitude,
            position.coords.longitude,
          ];
          const viewport =
            isFirstPosition && !prevState.isOriginExplicit
              ? fitMap(prevState.viewport, [
                  geolocationPosition,
                  prevState.destination &&
                    destinationToLatLng(prevState.destination),
                ])
              : prevState.viewport;
          const updateBase = { ...prevState, geolocationPosition, viewport };
          if (
            !prevState.isOriginExplicit &&
            (prevState.origin == null ||
              distance(prevState.origin, geolocationPosition) > 20)
          ) {
            return { ...updateBase, origin: geolocationPosition };
          }
          return updateBase;
        }
        return prevState;
      }
    );

  return (
    <div data-testid="app" className="App">
      <header className="App-header">
        <h2>Gatesolve</h2>
      </header>
      <ReactAutosuggestGeocoder
        url="https://api.digitransit.fi/geocoding/v1/"
        sources="oa,osm,nlsfi"
        highlightFirstSuggestion
        inputProps={{ placeholder: "Destination name or address" }}
        center={{
          latitude:
            state.geolocationPosition?.[0] ||
            state.origin?.[0] ||
            state.destination?.lat ||
            metropolitanAreaCenter[0],
          longitude:
            state.geolocationPosition?.[1] ||
            state.origin?.[1] ||
            state.destination?.lon ||
            metropolitanAreaCenter[1],
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSuggestionSelected={(event: any, { suggestion }: any): any => {
          const destination: LatLng = [
            suggestion.geometry.coordinates[1],
            suggestion.geometry.coordinates[0],
          ];
          const [type, id] = suggestion.properties.source_id.split(":");
          setState(
            (prevState): State => {
              const viewport = fitMap(prevState.viewport, [
                prevState.origin,
                destination,
              ]);
              return {
                ...prevState,
                origin: prevState.origin,
                destination: {
                  lat: destination[0],
                  lon: destination[1],
                  type,
                  id: Number(id),
                },
                viewport: { ...prevState.viewport, ...viewport },
              };
            }
          );
        }}
      />
      <GatesolveMap viewport={state.viewport} origin={state.origin} destination={state.destination}
                    onDestinationMoved={(destination) => null}
                    onOriginMoved={(origin) => null}
                    onMapClicked={handleMapClick}
                    onMapUpdated={(map) => setState(prevState => ({...prevState, map}))}>
        <GeolocateControl
          dataTestId="geolocate-control"
          enableOnMount
          onEnable={(isInitiatedByUser): void => {
            setState((prevState) => ({
              ...prevState,
              isOriginExplicit:
                !isInitiatedByUser && prevState.isOriginExplicit,
              isGeolocating: true,
            }));
          }}
          onDisable={(): void => {
            setState((prevState) => ({
              ...prevState,
              isGeolocating: false,
              geolocationPosition: null,
            }));
          }}
          onGeolocate={onGeolocate}
        />
        {state.geolocationPosition != null && (
          <Marker
            offset={[-20, -20]}
            longitude={state.geolocationPosition[1]}
            latitude={state.geolocationPosition[0]}
          >
            <UserPosition dataTestId="user-marker" />
          </Marker>
        )}
        {state.popupCoordinates != null && (
          <Popup
            latitude={state.popupCoordinates[0]}
            longitude={state.popupCoordinates[1]}
            closeButton={false}
            closeOnClick
            onClose={(): void =>
              setState(
                (prevState): State => ({ ...prevState, popupCoordinates: null })
              )
            }
          >
            <button
              data-testid="origin-button"
              type="button"
              aria-label="Set origin"
              onClick={(): void =>
                setState(
                  (prevState): State => {
                    // Check this to appease the compiler.
                    if (prevState.popupCoordinates != null) {
                      return {
                        ...prevState,
                        origin: prevState.popupCoordinates,
                        isOriginExplicit: true,
                        popupCoordinates: null,
                      };
                    }
                    return {
                      ...prevState,
                      isOriginExplicit: true,
                      popupCoordinates: null,
                    };
                  }
                )
              }
            >
              Origin
            </button>
            <button
              data-testid="destination-button"
              type="button"
              aria-label="Set destination"
              onClick={(): void =>
                setState(
                  (prevState): State => {
                    // Check this to appease the compiler.
                    if (prevState.popupCoordinates != null) {
                      return {
                        ...prevState,
                        destination: latLngToDestination(
                          prevState.popupCoordinates
                        ),
                        popupCoordinates: null,
                      };
                    }
                    return {
                      ...prevState,
                      popupCoordinates: null,
                    };
                  }
                )
              }
            >
              Destination
            </button>
          </Popup>
        )}
      </GatesolveMap>
    </div>
  );
};

export default App;
