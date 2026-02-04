BIN=.venv/bin/

CURRENT_USER := $(shell whoami)
LOCAL_IP := $(shell hostname -I | awk '{print $$1}')

install:
	sudo apt install -y jq
	sudo apt install -y python3-picamera2
	python -m venv .venv --system-site-packages
	$(BIN)pip install Flask==3.1.1 Flask-SocketIO==5.6.0 opencv-python==4.13.0.90 gevent==25.9.1 gevent-websocket==0.10.1 setproctitle==1.3.7
	gcc -fPIC -shared ./backend/camera_mount/mount_functions.c ./backend/camera_mount/PCA9685.c ./backend/camera_mount/PCA9685.h -o ./backend/camera_mount/mount_functions.o
	mkdir album
	chmod 0777 album
	echo "dtparam=i2c_arm=on" | sudo tee -a /boot/firmware/config.txt
	echo "[Unit]\nDescription=Pi Camera Car\nAfter=network.target\n\n[Service]\nWorkingDirectory=/home/$(CURRENT_USER)/pi-camera-car\nExecStart=/home/$(CURRENT_USER)/pi-camera-car/start_exec\nType=forking\nUser=$(CURRENT_USER)\n\n[Install]\nWantedBy=multi-user.target" | sudo tee /etc/systemd/system/car.service
	sudo systemctl daemon-reload
	sudo systemctl enable car.service
	sudo reboot

start:
	$(BIN)python ./backend/app.py &

start-public:
	$(BIN)python ./backend/app.py &
	ngrok start app &

stop:
	@if ! pgrep pi-camera-car > /dev/null; then \
		echo "Pi Camera Car is not currently running."; \
	else \
		pkill -9 pi-camera-car; \
		echo "Pi Camera Car stopped successfully."; \
	fi
	@if ! pgrep ngrok > /dev/null; then \
		echo "ngrok is not currently running."; \
	else \
		pkill -9 ngrok; \
		echo "ngrok stopped successfully."; \
	fi

get-url:
	@if pgrep ngrok > /dev/null; then \
		curl -s localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url'; \
	elif pgrep pi-camera-car > /dev/null; then \
		echo "http://${LOCAL_IP}:8000"; \
	else \
		echo "Pi Camera Car is not running."; \
	fi

compile-camera-mount:
	gcc -fPIC -shared ./backend/camera_mount/mount_functions.c ./backend/camera_mount/PCA9685.c ./backend/camera_mount/PCA9685.h -o ./backend/camera_mount/mount_functions.o
