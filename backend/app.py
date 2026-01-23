import cv2
import time
import RPi.GPIO as GPIO
from picamera2 import Picamera2
from flask import Flask, send_file
from flask_socketio import SocketIO, emit
from flask import render_template
import base64
import ctypes
import random
import string
import os

app = Flask(__name__, static_folder="../frontend/dist/assets", template_folder="../frontend/dist")

# Define cokoino 4wd robot hat control pins
NSLEEP1 = 12  # The 1# drv8833 NSLEEP pin is connected to the GPO12 pin
AN11 = 17     # The 1# drv8833 AN1 pin is connected to the GPO17 pin
AN12 = 27     # The 1# drv8833 AN2 pin is connected to the GPO27 pin
BN11 = 22     # The 1# drv8833 BN1 pin is connected to the GPO22 pin
BN12 = 23     # The 1# drv8833 BN2 pin is connected to the GPO23 pin
NSLEEP2 = 13  # The 2# drv8833 NSLEEP pin is connected to the GPO13 pin
AN21 = 24     # The 2# drv8833 AN1 pin is connected to the GPO24 pin
AN22 = 25     # The 2# drv8833 AN2 pin is connected to the GPO25 pin
BN21 = 26     # The 2# drv8833 BN1 pin is connected to the GPO26 pin
BN22 = 16     # The 2# drv8833 BN2 pin is connected to the GPO16 pin

servo_pin = 21  # The servo is connected to the GPO21 pin
temp1=1         # Assign the variable temp1 to 1

# Set GPIO mode to BCM
GPIO.setmode(GPIO.BCM)
# Set pins to output mode
GPIO.setup(NSLEEP1,GPIO.OUT)
GPIO.setup(NSLEEP2,GPIO.OUT)
GPIO.setup(AN11,GPIO.OUT)
GPIO.setup(AN12,GPIO.OUT)
GPIO.setup(BN21,GPIO.OUT)
GPIO.setup(BN22,GPIO.OUT)
GPIO.setup(servo_pin, GPIO.OUT)
#Initialize DRV8833 signal
GPIO.output(AN11,GPIO.LOW)
GPIO.output(AN12,GPIO.LOW)
GPIO.output(BN21,GPIO.LOW)
GPIO.output(BN22,GPIO.LOW)

p1=GPIO.PWM(NSLEEP1,1000) #Initialize the PWM of NSLEEP1 pin and set the frequency to 1000Hz.
p2=GPIO.PWM(NSLEEP2,1000) #Initialize the PWM of NSLEEP2 pin and set the frequency to 1000Hz.
p1.start(30) #Start PWM with an initial duty cycle of 30
p2.start(30) #Start PWM with an initial duty cycle of 30

# Create PWM object with frequency set to 50Hz
pwm = GPIO.PWM(servo_pin, 50)
pwm.start(0)

socketio = SocketIO(app)

lib_path = './backend/camera_mount/mount_functions.o'
c_functions = ctypes.CDLL(lib_path)

picam2 = Picamera2()
#camera_config = picam2.create_video_configuration(main={"size": (240, 180), "format": "RGB888"})
camera_config = picam2.create_video_configuration(main={"size": (1440, 1080), "format": "RGB888"}, lores={"size": (256, 160), "format": "YUV420"})
picam2.configure(camera_config)
picam2.set_controls({"FrameRate": 20, "NoiseReductionMode": 1})
picam2.start()

c_functions.init()

max_steer = 360
max_drive = 360

def cap_value(value, max_value):
	if value > max_value:
		value = max_value
	elif value < -max_value:
		value = -max_value
	return value

def round_to_nearest(number, nearest):
  nearest_multiple = round(number / nearest) * nearest
  return nearest_multiple

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

def take_photo():
	frame = picam2.capture_array()
	frame = cv2.flip(frame, 0)
	frame = cv2.flip(frame, 1)
	cv2.imwrite(f'./album/{generate_random_string(10)}.jpg', frame)

	return get_album()

def process_delete_photo(photo):
	os.remove(f'./album/{os.path.basename(photo)}')

def process_command(data):
	drive = None
	steer_angle = None
	device = data['device']
	
	if device == 'movement':
		if data['drive'] == None:
			GPIO.output(AN11,GPIO.LOW)
			GPIO.output(AN12,GPIO.LOW)
			GPIO.output(BN21,GPIO.LOW)
			GPIO.output(BN22,GPIO.LOW)
		else:
			#c_functions.reset_pan()
			# handle throttle
			drive = cap_value(data['drive'], max_drive)
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

			drive = round((abs(drive) / max_drive) * 90)
			if drive < 40:
				drive = 40
			p1.ChangeDutyCycle(drive)
			p2.ChangeDutyCycle(drive)

		if data['steer'] == None:
			pwm.ChangeDutyCycle(0)
		else:
			steer = -cap_value(data['steer'], max_steer)
			steer += max_steer
			steer_angle = round(steer / (max_steer * 2) * 180)
			steer_angle = round_to_nearest(steer_angle, 10)
			if drive is None or drive <= 50:
				if steer_angle < 50:
					steer_angle = 50
				elif steer_angle > 100:
					steer_angle = 100
			duty_cycle = steer_angle / 18 + 2
			pwm.ChangeDutyCycle(duty_cycle)
	else:
		if data['drive'] is not None:
			if data['drive'] > 0:
				c_functions.tilt_up()
			else:
				c_functions.tilt_down()
		if data['steer'] is not None:
			if data['steer'] > 0:
				c_functions.pan_right()
			else:
				c_functions.pan_left()

	print(f'drive: {drive}, steer: {steer_angle}, device: {device}')

def stream_frames():
	while True:
		frame = picam2.capture_array('lores')
		frame = cv2.cvtColor(frame, cv2.COLOR_YUV420p2RGB)
		frame = cv2.flip(frame, 0)
		frame = cv2.flip(frame, 1)
		ret, buffer = cv2.imencode('.jpg', frame)
		if ret:
			jpg_as_text = base64.b64encode(buffer).decode('utf-8')
			socketio.emit('video_frame', {'image': jpg_as_text})
		time.sleep(0.1)

@app.route("/")
def index():
	return render_template("index.html")

@app.route('/photo/<filename>', methods=['GET'])
def get_image(filename):
	image_path = f'../album/{filename}'
	return send_file(image_path, mimetype='image/jpeg')

@socketio.on('connect')
def test_connect(_):
	socketio.start_background_task(stream_frames)
	emit('album', get_album())

@socketio.on('command')
def command(data):
	process_command(data)
	emit('command_status', data)

@socketio.on('photo')
def photo():
	ret = take_photo()
	emit('photo_status', ret)

@socketio.on('delete_photo')
def delete_photo(photo):
	process_delete_photo(photo)
	emit('album', get_album())

if __name__ == '__main__':
	app.run(host='0.0.0.0', port=8000, debug=False, threaded=True, use_reloader=False)
