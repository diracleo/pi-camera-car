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
} from "@chakra-ui/react"
import {
  LuCamera,
  LuCarFront,
  LuImages,
  LuTrash2,
  LuLightbulb,
  LuLightbulbOff,
  LuSwitchCamera,
} from "react-icons/lu"
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

import './App.css';
import GestureDriveImg from './assets/gesture-left.png';
import GestureSteerImg from './assets/gesture-right.png';

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
  const [driveActive, setDriveActive] = useState(false);
  const [steerActive, setSteerActive] = useState(false);
  const [device, setDevice] = useState('movement');
  const [albumOpen, setAlbumOpen] = useState(false);
  const [openPhoto, setOpenPhoto] = useState(null);
  const [album, setAlbum] = useState(['']);
  const [photoTakenStyle, setPhotoTakenStyle] = useState({ display: 'none', opacity: 1 });
  const [photoTaken, setPhotoTaken] = useState(false);
  const [light, setLight] = useState(false);
  const photoTakenTimer = useRef(null);
  const socket = useRef(null);
  const windowDimensions = useWindowDimensions();
  
  useEffect(() => {
    if (commandTimer.current) {
      return;
    }

    socket.current = io.connect('/');
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
      console.log(data);
      driveValuePrev.current = data.drive === null ? null : parseInt(data.drive);
      steerValuePrev.current = data.steer === null ? null : parseInt(data.steer);
    });
    socket.current.on('album', function(data) {
      setAlbum(data);
      setOpenPhoto(null);
    });
    socket.current.on('photo_status', function(data) {
      setAlbum(data);
    });

    const optionsDrive = {
      zone: drive.current,
      lockY: true,
      shape: "square",
    };
    managerDrive.current = nipplejs.create(optionsDrive);
    const optionsSteer = {
      zone: steer.current,
      lockX: true,
      shape: "square",
    };
    managerSteer.current = nipplejs.create(optionsSteer);

    managerDrive.current.on('start', () => {
      driveValue.current = 0;
      setDriveActive(true);
    }).on('end', () => {
      setDriveActive(false);
    }).on('move', (evt, data) => {
      if (data.force && data.direction) {
	      driveValue.current = convertNippleData(data);
      }
    });

    managerSteer.current.on('start', () => {
      setSteerActive(true);
    }).on('end', () => {
      setSteerActive(false);
    }).on('move', (evt, data) => {
      if (data.force && data.direction) {
	      steerValue.current = convertNippleData(data);
      }
    });
  }, []);

  useEffect(() => {
    if (commandTimer.current) {
      clearInterval(commandTimer.current);
    }
    commandTimer.current = setInterval(() => {
      const driveValueCurated = driveActive ? driveValue.current : null;
      const steerValueCurated = steerActive ? steerValue.current : null;
      if (driveValueCurated !== driveValuePrev.current || steerValueCurated !== steerValuePrev.current) {
        //console.log(`drive: ${driveValueCurated}, steer: ${steerValueCurated}`);
        socket.current.emit('command', {
          drive: driveValueCurated,
          steer: steerValueCurated,
          device: device,
        });
      }
    }, 200);
  }, [driveActive, steerActive, device]);

  const appClass = useMemo(() => {
    if (driveActive || steerActive) {
      return 'App--active';
    }
    return 'App--inactive';
  }, [driveActive, steerActive]);

  const gestureAlignmentClass = useMemo(() => {
    const aspectRatio = 1.333;
    const videoWidth = window.innerHeight * aspectRatio;
    if (videoWidth >= window.innerWidth) {
      return 'gesture-alignBottom';
    }
    return 'gesture-alignCenter';
  }, [windowDimensions]);

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
  
  useEffect(() => {
    socket.current.emit('toggle_light', light);
  }, [light]);

  const buttonsDisabled = openPhoto || albumOpen;

  return (
    <ChakraProvider value={defaultSystem}>
      <div className={`App dark ${appClass}`}>
        <div className="feed">
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
        </div>
        <div id="controls">
          <div className="zone" id="drive" ref={drive}>
            <div className={`gesture ${gestureAlignmentClass} gesture-drive${(!driveActive && !openPhoto && !albumOpen) ? ' gesture--visible' : ''}`}>
              <img src={GestureDriveImg} />
            </div>
          </div>
          <div className="zone" id="steer" ref={steer}>
            <div className={`gesture ${gestureAlignmentClass} gesture-steer${(!steerActive && !openPhoto && !albumOpen) ? ' gesture--visible' : ''}`}>
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
                    <img src={item} onClick={() => setOpenPhoto(item)} className="thumb-img" />
                  </GridItem>
                ))}
              </Grid>
            </div>
          </div>
        )}
        {openPhoto && (
          <div className="photo">
            <TransformWrapper centerOnInit={true}>
              <TransformComponent>
                <div className="photo-inner">
                  <img src={openPhoto} className="photo-img" />
                </div>
              </TransformComponent>
            </TransformWrapper>
            <div className="photo-close">
              <CloseButton color="white" size="sm" variant="solid" onClick={() => setOpenPhoto(null)} />
            </div>
            <div className="photo-delete">
              <IconButton color="white" size="sm" variant="solid" onClick={() => deletePhoto(openPhoto)}>
                <LuTrash2 color="white" />
              </IconButton>
            </div>
          </div>
        )}
        <div className="settings settings-left">
          <Flex gap="2">
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
                  value: "movement",
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
