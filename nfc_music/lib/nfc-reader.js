'use strict';

const pcsclite = require('pcsclite');

class NfcReader {

    constructor(options = {}) {
        this.logger = options.logger || console;
        this.onTag = options.onTag || (() => {});

        this.pcsc = null;
        this.reader = null;
    }

start() {

    this.logger.info('NFC: PC/SC initialiseren');

    this.pcsc = pcsclite();

    this.pcsc.on('reader', reader => {

        this.reader = reader;

        this.logger.info(
            `NFC: reader gevonden: ${reader.name}`
        );

        reader.on('error', err => {
            this.logger.error(
                `NFC reader error: ${err.message}`
            );
        });

        reader.on('status', status => {

            const changes = reader.state ^ status.state;

            if (!changes) {
                return;
            }

            if ((changes & reader.SCARD_STATE_PRESENT) &&
                (status.state & reader.SCARD_STATE_PRESENT)) {

                this.logger.info('NFC: tag gedetecteerd');

                this._readUid(reader);
            }

            if ((changes & reader.SCARD_STATE_EMPTY) &&
                (status.state & reader.SCARD_STATE_EMPTY)) {

                this.logger.info('NFC: tag verwijderd');
            }
        });

        reader.on('end', () => {

            this.logger.info(
                `NFC: reader verwijderd: ${reader.name}`
            );

            this.reader = null;
        });
    });

    this.pcsc.on('error', err => {

        this.logger.error(
            `NFC PC/SC error: ${err.message}`
        );
    });

    /*
     * PC/SC is geïnitialiseerd.
     *
     * We hoeven niet te wachten totdat de reader
     * gevonden wordt. Volumio moet onStart() kunnen
     * afronden.
     */
    return Promise.resolve();
} // start module eind

    _readUid(reader) {

        reader.connect(
            {
                share_mode: reader.SCARD_SHARE_SHARED
            },
            (err, protocol) => {

                if (err) {
                    this.logger.error(
                        `NFC connect error: ${err.message}`
                    );
                    return;
                }

                reader.transmit(
                    Buffer.from([
                        0xff, 0xca, 0x00, 0x00, 0x00
                    ]),
                    40,
                    protocol,
                    (err, data) => {

                        if (err) {

                            this.logger.error(
                                `NFC UID uitlezen mislukt: ${err.message}`
                            );

                        } else {

                            const uid = data
                                .slice(0, -2)
                                .toString('hex')
                                .toUpperCase();

                            this.logger.info(
                                `NFC UID: ${uid}`
                            );

                            /*
                             * Geef de UID door aan de volgende laag.
                             */
                            Promise.resolve(this.onTag(uid))
                                .catch(error => {
                                    this.logger.error(
                                        `NFC tag handler error: ${error.message}`
                                    );
                                });
                        }

                        reader.disconnect(
                            reader.SCARD_LEAVE_CARD,
                            disconnectError => {

                                if (disconnectError) {
                                    this.logger.error(
                                        `NFC disconnect error: ${disconnectError.message}`
                                    );
                                }
                            }
                        );
                    }
                );
            }
        );
    }

    stop() {

        this.logger.info('NFC: reader stoppen');

        if (this.pcsc) {
            this.pcsc.close();
            this.pcsc = null;
        }

        this.reader = null;
    }
}

module.exports = NfcReader;
