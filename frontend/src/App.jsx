import React, {useEffect, useRef, useState, useMemo } from 'react';
import nipplejs from 'nipplejs';
import { io } from "socket.io-client";
import {
  ChakraProvider,
  defaultSystem,
  SegmentGroup,
  HStack,
  IconButton,
  Flex,
  Grid,
  GridItem,
  Float,
  Circle,
  CloseButton,
  Icon,
  Presence,
  Button,
  Input,
  Field,
} from "@chakra-ui/react"
import {
  LuCamera,
  LuCarFront,
  LuImages,
  LuTrash2,
  LuLightbulb,
  LuLightbulbOff,
  LuSwitchCamera,
  LuMic,
  LuMicOff,
} from "react-icons/lu"
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

import GestureDriveImg from './assets/gesture-left.png';
import GestureSteerImg from './assets/gesture-right.png';

import './App.css';

// The number of milliseconds between joystick position emissions to the backend.
// A lower number causes more frequent syncing and a theoretically more responsive experience,
// but it comes at a trade-off of possibly overloading the system with too many requests.
const CONTROLS_VEHICLE_SYNC_INTERVAL_MS = 25;
const CONTROLS_CAMERA_SYNC_INTERVAL_MS = 50;

const CAMERA_ASPECT_RATIO = 4 / 3;

// If controls aren't activated for this amount of time, the feed will go into an idle state
// where new frames aren't sent. This saves on bandwidth.
// Set to 0 to disable.
const IDLE_TIME_MS = 10000;

const getWindowDimensions = () => {
  const { innerWidth: width, innerHeight: height } = window;
  return {
    width,
    height
  };
}

const useWindowDimensions = () => {
  const [windowDimensions, setWindowDimensions] = useState(getWindowDimensions());

  useEffect(() => {
    function handleResize() {
      setWindowDimensions(getWindowDimensions());
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return windowDimensions;
}

const convertNippleData = (data) => {
  let modifier = 1;
  if (data.direction.x === 'left' || data.direction.y === 'down') {
    modifier = -1;
  }
  return Math.round(data.force * modifier * 100);
};

function App() {
  const drive = useRef(null);
  const steer = useRef(null);
  const managerDrive = useRef(null);
  const managerSteer = useRef(null);
  const driveValue = useRef(null);
  const steerValue = useRef(null);
  const driveValuePrev = useRef(null);
  const steerValuePrev = useRef(null);
  const commandTimer = useRef(null);
  const feed = useRef(null);
  const photoTakenTimer = useRef(null);
  const socket = useRef(null);
  const currentLatency = useRef(null);
  const idleTimer = useRef(null);
  const [driveActive, setDriveActive] = useState(false);
  const [steerActive, setSteerActive] = useState(false);
  const [device, setDevice] = useState('vehicle');
  const [albumOpen, setAlbumOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(null);
  const [mic, setMic] = useState(false);
  const [album, setAlbum] = useState(['']);
  const [photoTaken, setPhotoTaken] = useState(false);
  const [light, setLight] = useState(false);
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authenticationError, setAuthenticationError] = useState(false);
  const [authenticateLoading, setAuthenticateLoading] = useState(false);
  const [showLatencyWarning, setShowLatencyWarning] = useState(false);
  const [idle, setIdle] = useState(false);
  const windowDimensions = useWindowDimensions();
  
  useEffect(() => {
    if (window.requireAuth && !authenticated) {
      return;
    }

    socket.current = io.connect(`/?password=${password}`);
    socket.current.on('connect', function() {
      console.log('Connected to server');
    });

    const ctx = feed.current.getContext('2d');
    const img = new Image();

    socket.current.on('video_frame', function(data) {
      img.src = 'data:image/jpeg;base64,' + data.image;
      img.onload = () => {
        feed.current.width = img.width;
        feed.current.height = img.height;
        ctx.drawImage(img, 0, 0, feed.current.width, feed.current.height);
      };
    })
    socket.current.on('command_status', function(data) {
      driveValuePrev.current = data.drive === null ? null : parseInt(data.drive);
      steerValuePrev.current = data.steer === null ? null : parseInt(data.steer);
    });
    socket.current.on('album', function(data) {
      setAlbum(data);
      setPhotoOpen(null);
    });
  }, [authenticated]);

  const handleResetIdle = () => {
    if (IDLE_TIME_MS) {
      setIdle(false);
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
      }
      idleTimer.current = setTimeout(() => {
        setIdle(true);
      }, [IDLE_TIME_MS]);
    }
  };

  const mode = useMemo(() => {
    const aspectRatio = CAMERA_ASPECT_RATIO;
    const videoWidth = window.innerHeight * aspectRatio;
    if (videoWidth >= window.innerWidth) {
      return 'portrait';
    }
    return 'landscape';
  }, [windowDimensions]);

  useEffect(() => {
    if (managerDrive.current) {
      managerDrive.current.destroy();
    }
    if (managerSteer.current) {
      managerSteer.current.destroy();
    }

    handleResetIdle();

    const optionsDrive = {
      zone: drive.current,
      lockY: true,
      shape: 'square',
      mode: 'dynamic',
    };
    managerDrive.current = nipplejs.create(optionsDrive);
    let optionsSteer = null;
    if (device == 'vehicle') {
      optionsSteer = {
        zone: steer.current,
        lockX: true,
        shape: 'square',
        restJoystick: false,
        mode: 'static',
        position: { top: 'calc(50% + 20px)', right: '120px' },
      };
    } else {
      optionsSteer = {
        zone: steer.current,
        lockX: true,
        shape: 'square',
        mode: 'dynamic',
      };
    }
    managerSteer.current = nipplejs.create(optionsSteer);

    managerDrive.current.on('start', () => {
      driveValue.current = 0;
      setDriveActive(true);
    }).on('end', () => {
      setDriveActive(false);
    }).on('move', (evt, data) => {
      if (data.force && data.direction) {
        driveValue.current = convertNippleData(data);
        handleResetIdle();
      }
    });

    managerSteer.current.on('start', () => {
      setSteerActive(true);
    }).on('end', () => {
      setSteerActive(false);
    }).on('move', (evt, data) => {
      if (data.force && data.direction) {
        steerValue.current = convertNippleData(data);
        handleResetIdle();
      }
    });
  }, [device]);

  useEffect(() => {
    if (commandTimer.current) {
      clearInterval(commandTimer.current);
    }
    const sync_interval = device == 'vehicle' ? CONTROLS_VEHICLE_SYNC_INTERVAL_MS : CONTROLS_CAMERA_SYNC_INTERVAL_MS;
    commandTimer.current = setInterval(() => {
      const driveValueCurated = driveActive ? driveValue.current : null;
      const steerValueCurated = steerActive ? steerValue.current : null;
      if (!showLatencyWarning) {
        // The vehicle moves by setting values and the camera moves by incrementing or decrementing values
        // so for the vehicle, only emit data when there's a change, and for the camera, always emit data.
        if (device == 'camera' || (driveValueCurated !== driveValuePrev.current || steerValueCurated !== steerValuePrev.current)) {
          currentLatency.current = Date.now();
          socket.current.emit('command', {
            drive: driveValueCurated,
            steer: steerValueCurated,
            device: device,
          });
        }
      }
    }, sync_interval);
  }, [driveActive, steerActive, device, showLatencyWarning]);

  const appClass = useMemo(() => {
    let className = `App--${mode}`;
    if (window.requireAuth && !authenticated) {
      className += ' App--unauthenticated';
    } else if (driveActive || steerActive) {
      className += ' App--active';
    } else {
      className += ' App--inactive';
    }
    return className;
  }, [driveActive, steerActive, authenticated, mode]);

  const takePhoto = () => {
    socket.current.emit('photo');
    setPhotoTaken(true);
    if (photoTakenTimer.current) {
      clearTimeout(photoTakenTimer.current);
    }
    photoTakenTimer.current = setTimeout(() => {
      setPhotoTaken(false);
    }, [500]);
  };

  const deletePhoto = (photo) => {
    socket.current.emit('delete_photo', photo);
  };

  const authenticate = () => {
    setAuthenticateLoading(true);
    const postData = { 
      password: password,
    };
    const requestOptions = {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postData)
    };
    const sendAuthenticateRequest = async () => {
      try {
        const response = await fetch('/authenticate', requestOptions);
        if (!response.ok) {
          setAuthenticationError('Failed to authenticate');
          setAuthenticateLoading(false);
        }
        const data = await response.json();
        if (data.success) {
          setAuthenticated(true);
        } else {
          setAuthenticationError('Failed to authenticate');
        }
        setAuthenticateLoading(false);
      } catch (err) {
        setAuthenticationError('Failed to authenticate');
        setAuthenticateLoading(false);
      }
    };

    sendAuthenticateRequest();
  };

  useEffect(() => {
    if (socket.current) {
      socket.current.emit('idle', idle);
    }
  }, [idle]);

  useEffect(() => {
    if (socket.current) {
      socket.current.emit('light', light);
      handleResetIdle();
    }
  }, [light]);

  useEffect(() => {
    if (socket.current) {
      socket.current.emit('mic', mic);
      handleResetIdle();
    }
  }, [mic]);

  const gestureAlignmentClass = useMemo(() => {
    const aspectRatio = CAMERA_ASPECT_RATIO;
    const videoWidth = window.innerHeight * aspectRatio;
    if (videoWidth >= window.innerWidth) {
      return 'gesture-alignBottom';
    }
    return 'gesture-alignCenter';
  }, [windowDimensions]);

  const buttonsDisabled = photoOpen || albumOpen;

  return (
    <ChakraProvider value={defaultSystem}>
      <div className={`App dark ${appClass}`}>
        {(window.requireAuth && !authenticated) && (
          <div className="App-unauthenticated dark">
            <Field.Root invalid={authenticationError}>
              <Input bg="#111" color="#fff" placeholder="Enter password" onChange={(ev) => setPassword(ev.target.value)} value={password} />
              {authenticationError && (
                <Field.ErrorText>{authenticationError}</Field.ErrorText>
              )}
            </Field.Root>
            <Button colorPalette="blue" onClick={authenticate} loading={authenticateLoading}>Login</Button>
          </div>
        )}
        <div className={`feed${idle ? ' feed--idle' : ''}`}>
          <canvas ref={feed}></canvas>
          <Presence
            present={photoTaken}
            _open={{ animationName: "fade-in", animationDuration: "30ms" }}
            _closed={{ animationName: "fade-out", animationDuration: "1500ms" }}
          >
            <div className="photoTaken">
              <Icon size="lg" color="blue">
                <LuCamera />
              </Icon>
            </div>
          </Presence>
          <Presence
            present={showLatencyWarning}
            _open={{ animationName: "fade-in", animationDuration: "30ms" }}
            _closed={{ animationName: "fade-out", animationDuration: "1500ms" }}
          >
            <div className="feedNotification">
              <p>High latency detected. Controls are disabled. Please wait.</p>
            </div>
          </Presence>
          <Presence
            present={idle}
            _open={{ animationName: "fade-in", animationDuration: "3000ms" }}
            _closed={{ animationName: "fade-out", animationDuration: "300ms" }}
          >
            <div className="feedNotification">
              <p>You are currently idle. Touch the controls to begin.</p>
            </div>
          </Presence>
        </div>
        <div id="controls">
          <div className="zone" id="drive" ref={drive}>
            <div className={`gesture ${gestureAlignmentClass} gesture-drive${(!driveActive && !photoOpen && !albumOpen) ? ' gesture--visible' : ''}`}>
              <img src={GestureDriveImg} />
            </div>
          </div>
          <div className="zone" id="steer" ref={steer}>
            <div className={`gesture ${gestureAlignmentClass} gesture-steer${(device == 'camera' && !steerActive && !photoOpen && !albumOpen) ? ' gesture--visible' : ''}`}>
              <img src={GestureSteerImg} />
            </div>
          </div>
        </div>
        {albumOpen && (
          <div className="overlay"></div>
        )}
        {albumOpen && (
          <div className="album">
            <div className="album-scroll">
              <Grid templateColumns="repeat(8, 1fr)" gap="1" autoFlow={true}>
                {album.map((item, index) => (
                  <GridItem key={index}>
                    <img src={item} onClick={() => setPhotoOpen(item)} className="thumb-img" />
                  </GridItem>
                ))}
              </Grid>
            </div>
          </div>
        )}
        {photoOpen && (
          <div className="photo">
            <TransformWrapper centerOnInit={true}>
              <TransformComponent>
                <div className="photo-inner">
                  <img src={photoOpen} className="photo-img" />
                </div>
              </TransformComponent>
            </TransformWrapper>
            <div className="photo-close">
              <CloseButton color="white" size="sm" variant="solid" onClick={() => setPhotoOpen(null)} />
            </div>
            <div className="photo-delete">
              <IconButton color="white" size="sm" variant="solid" onClick={() => deletePhoto(photoOpen)}>
                <LuTrash2 color="white" />
              </IconButton>
            </div>
          </div>
        )}
        <div className="settings settings-left">
          <Flex gap="2">
            <IconButton disabled={buttonsDisabled} aria-label="Toggle mic" size="lg" colorPalette={mic ? 'blue' : 'white'} variant="solid" onClick={() => setMic(!mic)}>
              {light ? (
                <LuMic color="white" />
              ) : (
                <LuMicOff color="white" />
              )}
            </IconButton>
            <IconButton aria-label="Take Photo" size="lg" colorPalette="white" variant="outline" disabled={buttonsDisabled} onClick={() => takePhoto()}>
              <LuCamera color="white" />
            </IconButton>
            <div className="album-button">
              {albumOpen ? (
                <CloseButton color="white" variant="outline" size="lg" onClick={() => setAlbumOpen(false)} />
              ) : (
                <>
                  {!!album.length && (
                    <>
                      <IconButton aria-label="View Album" size="lg" colorPalette="white" variant="outline" onClick={() => { setAlbumOpen(true) }}>
                        <LuImages color="white" />
                      </IconButton>
                      <Float placement="bottom-end" onClick={() => { setAlbumOpen(true) }}>
                        <Circle size="5" bg="blue" color="white">
                          {album.length}
                        </Circle>
                      </Float>
                    </>
                  )}
                </>
              )}
            </div>
          </Flex>
        </div>
        <div className="settings settings-right">
          <Flex gap="2">
            <IconButton disabled={buttonsDisabled} aria-label="Toggle Light" size="lg" colorPalette={light ? 'blue' : 'white'} variant="solid" onClick={() => setLight(!light)}>
              {light ? (
                <LuLightbulb color="white" />
              ) : (
                <LuLightbulbOff color="white" />
              )}
            </IconButton>
            <SegmentGroup.Root
              disabled={buttonsDisabled}
              size="lg"
              onValueChange={({ value }) => setDevice(value)}
              value={device}
              css={{
                "--segment-indicator-bg": "colors.blue.600",
                "--chakra-colors-bg-muted": "#333",
              }}
            >
              <SegmentGroup.Indicator />
              <SegmentGroup.Items items={[
                {
                  value: "vehicle",
                  label: (
                    <HStack>
                      <LuCarFront />
                    </HStack>
                  ),
                },
                {
                  value: "camera",
                  label: (
                    <HStack>
                      <LuSwitchCamera />
                    </HStack>
                  ),
                },
              ]}/>
            </SegmentGroup.Root>
          </Flex>
        </div>
      </div>
    </ChakraProvider>
  );
}

export default App
