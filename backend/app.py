from gevent import monkey
monkey.patch_all(thread=False, threading=False)

import signal
import sys
import atexit
import cv2
import RPi.GPIO as GPIO
from picamera2 import Picamera2
from flask import Flask, send_file, request
from flask_socketio import SocketIO, emit, ConnectionRefusedError
from flask import render_template, request
import base64
import ctypes
import random
import string
import os
import setproctitle
from threading import Event

DEBUG = True

# Frame rate of video stream
FRAME_RATE = 24

# Values below this do not provide enough power to move the car
# so anytime the throttle is activated, do not allow it to drop below this.
MIN_THROTTLE_VALUE = 40

# Anytime the throttle is activated, do not allow it to go above this.
MAX_THROTTLE_VALUE = 90

# A higher value results in more force being required to drive
DRIVE_SENSITIVITY = 200

# A higher value results in more force being required to steer
STEER_SENSITIVITY = 360

# Minimum allowed steer angle - any joystick value below this will be floored to this value
MIN_STEER_ANGLE = 61  # 0 to 180

# Maximum allowed steer angle - any joystick value above this will be ceilinged to this value
MAX_STEER_ANGLE = 110  # 0 to 180

# Force the camera to center horizontally when driving
CENTER_CAMERA_PAN_WHEN_DRIVING = True

# Force the camera to center vertically when driving
CENTER_CAMERA_TILT_WHEN_DRIVING = False

# The password to authenticate
# Set to False to disable auth
PASSWORD = False

app = Flask(__name__, static_folder="../frontend/dist/assets", template_folder="../frontend/dist")

led_pin = 10

NSLEEP1 = 12
AN11 = 17
AN12 = 27
BN11 = 22
BN12 = 23
NSLEEP2 = 13
AN21 = 24
AN22 = 25
BN21 = 26
BN22 = 16

servo_pin = 21

socketio = SocketIO(app, async_mode='gevent')

picam2 = None
pwm = None
p1 = None
p2 = None
camera_mount_controller = None
worker = None

thread_event = Event()

def cleanup():
  GPIO.cleanup()
  thread_event.clear()
  if DEBUG:
    print(f'cleanup')

atexit.register(cleanup)

def signal_handler(sig, frame):
    cleanup()
    sys.exit(0)

signal.signal(signal.SIGTERM, signal_handler)

def cap_value(value, max_value):
	if value > max_value:
		value = max_value
	elif value < -max_value:
		value = -max_value
	return value

def generate_random_string(length):
	characters = string.ascii_letters + string.digits
	random_string = ''.join(random.choices(characters, k=length))
	return random_string

def get_files_sorted_by_creation_date(directory_path):
	with os.scandir(directory_path) as entries:
		files_with_ctime = [(entry.stat().st_ctime, entry) for entry in entries if entry.is_file()]
	files_with_ctime.sort(reverse=True)
	sorted_files = [f'/photo/{entry.name}' for timestamp, entry in files_with_ctime]
	return sorted_files

def get_album():
	files_only = get_files_sorted_by_creation_date('./album')
	return files_only

def process_photo():
	frame = picam2.capture_array()
	frame = cv2.flip(frame, 0)
	frame = cv2.flip(frame, 1)
	image_file = f'./album/{generate_random_string(10)}.jpg'
	cv2.imwrite(image_file, frame)

	if DEBUG:
		print(f'photo taken: {image_file}')

def process_delete_photo(photo):
	os.remove(f'./album/{os.path.basename(photo)}')

def process_latency_problem():
	# When there's a latency problem, stop all vehicle movement
	print('latency problem')
	GPIO.output(AN11,GPIO.LOW)
	GPIO.output(AN12,GPIO.LOW)
	GPIO.output(BN21,GPIO.LOW)
	GPIO.output(BN22,GPIO.LOW)
	pwm.ChangeDutyCycle(0)

def process_command(data):
	drive = None
	steer_angle = None
	device = data['device']
	
	if device == 'vehicle':
		if data['drive'] == None:
			GPIO.output(AN11,GPIO.LOW)
			GPIO.output(AN12,GPIO.LOW)
			GPIO.output(BN21,GPIO.LOW)
			GPIO.output(BN22,GPIO.LOW)
		else:
			if CENTER_CAMERA_PAN_WHEN_DRIVING:
				camera_mount_controller.reset_pan()
			if CENTER_CAMERA_TILT_WHEN_DRIVING:
				camera_mount_controller.reset_tilt()

			# handle throttle
			drive = cap_value(data['drive'], DRIVE_SENSITIVITY)
			if drive > 0:
				# forward
				GPIO.output(AN11,GPIO.LOW)
				GPIO.output(AN12,GPIO.HIGH)
				GPIO.output(BN21,GPIO.LOW)
				GPIO.output(BN22,GPIO.HIGH)
			else:
				# reverse
				GPIO.output(AN11,GPIO.HIGH)
				GPIO.output(AN12,GPIO.LOW)
				GPIO.output(BN21,GPIO.HIGH)
				GPIO.output(BN22,GPIO.LOW)

			drive = round((abs(drive) / DRIVE_SENSITIVITY) * 90)
			if drive < MIN_THROTTLE_VALUE:
				# values below this cause the car to not move
				drive = MIN_THROTTLE_VALUE
			elif drive > MAX_THROTTLE_VALUE:
				drive = MAX_THROTTLE_VALUE
			p1.ChangeDutyCycle(drive)
			p2.ChangeDutyCycle(drive)

		if data['steer'] == None:
			pwm.ChangeDutyCycle(0)
		else:
			steer = -cap_value(data['steer'], STEER_SENSITIVITY)
			steer += STEER_SENSITIVITY
			steer_angle = round(steer / (STEER_SENSITIVITY * 2) * 180)
			if steer_angle < MIN_STEER_ANGLE:
				steer_angle = MIN_STEER_ANGLE
			elif steer_angle > MAX_STEER_ANGLE:
				steer_angle = MAX_STEER_ANGLE
			duty_cycle = steer_angle / 18 + 2
			pwm.ChangeDutyCycle(duty_cycle)

		if DEBUG:
			print(f'drive: {drive}, steer_angle: {steer_angle}')
	else:
		if data['drive'] is not None:
			if data['drive'] > 0:
				camera_mount_controller.tilt_up()
				if DEBUG:
					print('tilt camera up')
			else:
				camera_mount_controller.tilt_down()
				if DEBUG:
					print('tilt camera down')
		if data['steer'] is not None:
			if data['steer'] > 0:
				camera_mount_controller.pan_right()
				if DEBUG:
					print('pan camera right')
			else:
				camera_mount_controller.pan_left()
				if DEBUG:
					print('pan camera left')

class StreamFramesWorker(object):
	switch = False

	def __init__(self, socketio):
		self.socketio = socketio
		self.switch = True

	def stream_frames(self, event):
		try:
			while event.is_set():
				if self.switch:
					frame = picam2.capture_array('lores')
					frame = cv2.cvtColor(frame, cv2.COLOR_YUV420p2RGB)
					frame = cv2.flip(frame, 0)
					frame = cv2.flip(frame, 1)
					ret, buffer = cv2.imencode('.jpg', frame)
					if ret:
						jpg_as_text = base64.b64encode(buffer).decode('utf-8')
						socketio.emit('video_frame', {'image': jpg_as_text})
				socketio.sleep(0.05)
		finally:
			event.clear()
	
	def stop(self):
		self.switch = False
	
	def start(self):
		self.switch = True

@app.route("/")
def index():
	require_auth = 'true' if PASSWORD else 'false'
	return render_template("index.html", require_auth=require_auth)

@app.route('/photo/<filename>', methods=['GET'])
def get_image(filename):
	image_path = f'../album/{filename}'
	return send_file(image_path, mimetype='image/jpeg')

@app.route('/authenticate', methods=['POST'])
def authenticate():
	data = request.get_json()
	if 'password' not in data or data['password'] != PASSWORD:
		return { 'success': False }

	return { 'success': True }

@socketio.on('connect')
def connect():
	global picam2, pwm, p1, p2, camera_mount_controller

	if PASSWORD and request.args.get('password') != PASSWORD:
		raise ConnectionRefusedError('unauthorized!')
	
	if not picam2:
		GPIO.setmode(GPIO.BCM)
		GPIO.setup(NSLEEP1,GPIO.OUT)
		GPIO.setup(NSLEEP2,GPIO.OUT)
		GPIO.setup(AN11,GPIO.OUT)
		GPIO.setup(AN12,GPIO.OUT)
		GPIO.setup(BN21,GPIO.OUT)
		GPIO.setup(BN22,GPIO.OUT)
		GPIO.setup(servo_pin, GPIO.OUT)
		GPIO.output(AN11,GPIO.LOW)
		GPIO.output(AN12,GPIO.LOW)
		GPIO.output(BN21,GPIO.LOW)
		GPIO.output(BN22,GPIO.LOW)

		p1=GPIO.PWM(NSLEEP1,1000)
		p2=GPIO.PWM(NSLEEP2,1000)
		p1.start(30)
		p2.start(30)

		pwm = GPIO.PWM(servo_pin, 50)
		pwm.start(0)

		GPIO.setup(led_pin, GPIO.OUT)
		
		picam2 = Picamera2()
		camera_config = picam2.create_video_configuration(
			main={"size": (1440, 1080), "format": "RGB888"},
			lores={"size": (256, 160), "format": "YUV420"},
		)
		picam2.configure(camera_config)
		picam2.set_controls({"FrameRate": FRAME_RATE, "NoiseReductionMode": 1})
		picam2.start()

		# Pulled from https://github.com/ArduCAM/PCA9685/tree/master/example/rpi
		# See Makefile for how to modify and recompile the C functions
		camera_mount_lib_path = './backend/camera_mount/mount_functions.o'
		camera_mount_controller = ctypes.CDLL(camera_mount_lib_path)

		camera_mount_controller.init()

	camera_mount_controller.reset_pan()
	camera_mount_controller.reset_tilt()

	global worker
	worker = StreamFramesWorker(socketio)
	thread_event.set()
	socketio.start_background_task(worker.stream_frames, thread_event)

	emit('album', get_album())

@socketio.on('disconnect')
def on_disconnect():
	thread_event.clear()

@socketio.on('command')
def command(data):
	process_command(data)
	emit('command_status', data)

@socketio.on('latency_problem')
def latency_problem():
	process_latency_problem()

@socketio.on('photo')
def photo():
	process_photo()
	emit('album', get_album())

@socketio.on('light')
def light(data):
	if data:
		GPIO.output(led_pin, GPIO.HIGH)
		if DEBUG:
			print(f'light turned on')
	else:
		GPIO.output(led_pin, GPIO.LOW)
		if DEBUG:
			print(f'light turned off')

@socketio.on('mic')
def mic(data):
	if data:
		# TODO - handle mic on
		if DEBUG:
			print(f'light turned on')
	else:
		# TODO - handle mic off
		if DEBUG:
			print(f'light turned off')

@socketio.on('idle')
def idle(data):
	global worker
	if data:
		worker.stop()
		if DEBUG:
			print(f'user set to idle')
	else:
		worker.start()
		if DEBUG:
			print(f'user set to active')

@socketio.on('delete_photo')
def delete_photo(photo):
	process_delete_photo(photo)
	emit('album', get_album())

if __name__ == '__main__':
	setproctitle.setproctitle('pi-camera-car')
	socketio.run(app, host='0.0.0.0', port=8000, debug=False, use_reloader=False)
