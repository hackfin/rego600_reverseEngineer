# Heating model quick intro

These python snippets provide a back end for the rego600 simulator to
feed real temperature data from SMHI and model a virtual heating to
mock-up the relevant sensors for the rego600 controller.

They have only been tested on a setup with GT5 and GT4 disabled.
The warmwater circuit is also not simulated.

## Usage

Basically you run

```
> python3 temperature_server.py
```

prior to starting the web based rego600 simulator.

See also the comments in `temperature_server.py` on how to pull the SMHI
data.

## Web interface

A temperature plot appears in the web interface, once a connection was made.
If you wish to change the sample buffer size, change `windowSeconds` in
`rego600/temperature_client.js` accordingly.

For further questions, use github issues or contact the author(s) via
the concat information found in the various source files headers.
