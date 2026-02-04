#include "PCA9685.h"

void init() {
    char i2c_dev[32];
    snprintf(i2c_dev, sizeof(i2c_dev), "/dev/i2c-1");
    i2c_init(i2c_dev, I2C_ADDR);
    i2c_writeReg(MODE1, 0x80);
    usleep(10000);
    PCA9685_setPWMFreq(1000);
    PCA9685_setPWMFreq(60);
}
void reset_pan() {
    tcflush(0, TCIOFLUSH);
    setServoDegree(SERVO_DOWN_CH, 110);
}
void reset_tilt() {
    tcflush(0, TCIOFLUSH);
    setServoDegree(SERVO_UP_CH, 95);
}
void tilt_up() {
    tcflush(0, TCIOFLUSH);
    ServoDegreeIncrease(SERVO_UP_CH, STEP);
}
void tilt_down() {
    tcflush(0, TCIOFLUSH);
    ServoDegreeDecrease(SERVO_UP_CH, STEP);
}
void pan_left() {
    tcflush(0, TCIOFLUSH);
    ServoDegreeDecrease(SERVO_DOWN_CH, STEP);
}
void pan_right() {
    tcflush(0, TCIOFLUSH);
    ServoDegreeIncrease(SERVO_DOWN_CH, STEP);
}
