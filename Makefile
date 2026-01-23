BIN=.venv/bin/

install:
	sudo apt install -y python3-picamera2
	python -m venv .venv --system-site-packages
	$(BIN)pip install -r requirements.txt
	cd ./backend/camera_mount
	gcc -fPIC -shared mount_functions.c PCA9685.c PCA9685.h -o mount_functions.o
	cd ../../

run:
	$(BIN)python ./backend/app.py
