# Building Fabric From Source
Documentation targeting Ubuntu.

## Major Services
### Bitcoin
```
sudo apt-get install libboost-system-dev libboost-filesystem-dev libboost-chrono-dev libboost-program-options-dev libboost-test-dev libboost-thread-dev
git clone git@github.com:bitcoin/bitcoin.git
cd bitcoin
git checkout v0.21.1
./autogen.sh
./configure
make
sudo make install
```

### Lightning
```
git clone git@github.com:ElementsProject/lightning.git
cd lightning
git checkout master
./autogen.sh
./configure
make
sudo make install
```
