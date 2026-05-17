#!/bin/bash

pm2 stop orkut
rm /root/orkut/cursor.txt
touch /root/orkut/cursor.txt
pm2 start orkut
