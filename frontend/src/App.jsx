import React, {useEffect, useRef, useState, useMemo } from 'react';
import nipplejs from 'nipplejs';
import { io } from "socket.io-client";

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
  const driveValue = useRef(0);
  const steerValue = useRef(0);
  const driveValuePrev = useRef(0);
  const steerValuePrev = useRef(0);
  const commandTimer = useRef(null);
  const [driveActive, setDriveActive] = useState(false);
  const [steerActive, setSteerActive] = useState(false);
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
    socket.current.on('command_status', function(data) {
      console.log(data);
      driveValuePrev.current = parseInt(data.drive);
      steerValuePrev.current = parseInt(data.steer);
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
      driveValue.current = 0;
      setDriveActive(false);
    }).on('move', (evt, data) => {
      if (data.force && data.direction) {
	      driveValue.current = convertNippleData(data);
      }
    });

    managerSteer.current.on('start', () => {
      steerValue.current = 0;
      setSteerActive(true);
    }).on('end', () => {
      steerValue.current = 0;
      setSteerActive(false);
    }).on('move', (evt, data) => {
      if (data.force && data.direction) {
	      steerValue.current = convertNippleData(data);
      }
    });

    commandTimer.current = setInterval(() => {
      if (driveValue.current !== driveValuePrev.current || steerValue.current !== steerValuePrev.current) {
        socket.current.emit('command', {
          drive: driveValue.current,
          steer: steerValue.current,
        });
      }
    }, 200);
  }, []);

  useEffect(() => {
    if (driveActive && steerActive) {
      document.body.style.backgroundColor = '#111';
    } else {
      document.body.style.backgroundColor = '#333';
    }
  }, [driveActive, steerActive]);

  const gestureAlignmentClass = useMemo(() => {
    const aspectRatio = 1.333;
    const videoWidth = window.innerHeight * aspectRatio;
    if (videoWidth >= window.innerWidth) {
      return 'gesture-alignBottom';
    }
    return 'gesture-alignCenter';
  }, [windowDimensions]);

  return (
    <div className="App">
	    <div id="controls">
        <div className="zone" id="drive" ref={drive}>
          <div className={`gesture ${gestureAlignmentClass} gesture-drive${!driveActive ? ' gesture--visible' : ''}`}>
            <img src={GestureDriveImg} />
          </div>
        </div>
        <div className="zone" id="steer" ref={steer}>
          <div className={`gesture ${gestureAlignmentClass} gesture-steer${!steerActive ? ' gesture--visible' : ''}`}>
            <img src={GestureSteerImg} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App
