import cv2
import time
import RPi.GPIO as GPIO
from picamera2 import Picamera2
from flask import Response
from flask import Flask
from flask_socketio import SocketIO, emit
from flask import render_template

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
# Start PWM with an initial duty cycle of 0%
pwm.start(0)#Start PWM with an initial duty cycle of 30

socketio = SocketIO(app)

picam2 = Picamera2()
camera_config = picam2.create_video_configuration(main={"size": (320, 240), "format": "RGB888"})
picam2.configure(camera_config)
picam2.set_controls({"FrameRate": 20, "NoiseReductionMode": 1})
picam2.start()

def generate_frames():
  while True:
    frame = picam2.capture_array()
    frame = cv2.flip(frame, 0)
    _, buffer = cv2.imencode('.jpg', frame)
    frame = buffer.tobytes()
    yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

def set_angle(angle):
	# Calculate duty cycle (0.5ms to 2.5ms=>0% -180%)
	duty_cycle = angle / 18 + 2  # transcoding
	pwm.ChangeDutyCycle(duty_cycle)  # Modify the duty cycle of the servo motor

def process_command(data):
	#set_angle(90)  # Set the servo to 90 degrees
	if data['drive'] == 0:
		time.sleep(0.5)  # Wait for 0.5 seconds
		GPIO.output(AN11,GPIO.LOW) #Input low level to the AN1 pin of 1 # DRV8833
		GPIO.output(AN12,GPIO.LOW) #Input low level to the AN2 pin of 1 # DRV8833
		GPIO.output(BN21,GPIO.LOW) #Input low level to the BN1 pin of 2 # DRV8833
		GPIO.output(BN22,GPIO.LOW) #Input low level to the BN2 pin of 2 # DRV8833
	else:
		time.sleep(0.5)  # Wait for 0.5 seconds
		GPIO.output(AN11,GPIO.LOW)
		GPIO.output(AN12,GPIO.HIGH)
		GPIO.output(BN21,GPIO.LOW)
		GPIO.output(BN22,GPIO.HIGH)
	
@app.route("/")
def index():
	return render_template("index.html")

@app.route("/video_feed")
def video_feed():
	return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@socketio.on('command')
def command(data):
	#process_command(data)
	print(data)
	emit('command_status', data)

if __name__ == '__main__':
	app.run(host='0.0.0.0', port=8000, debug=False, threaded=True, use_reloader=False)
