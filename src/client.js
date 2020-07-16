const fs = require("fs");
const path = require("path");
const hbjs = require("handbrake-js");
const { getVideoDurationInSeconds } = require("get-video-duration");
const getDimensions = require("get-video-dimensions");

const SUFFIX = "-encoded";
const TARGET_SIZE = 8000 - 1;
const MINIMUM_WIDTH = 320;
const MINIMUM_HEIGHT = 240;
const TARGET_WIDTH = 854;
const TARGET_HEIGHT = 480;
// How many times it should try to transcode with a higher bitrate
const TRY_NOT_LOWERING_QUALITY = 2;

const logElem = document.getElementById("status");
const log = text => {
    let isAtBottom = false;
    if (logElem.scrollTop >= logElem.scrollHeight - logElem.offsetHeight - 20)
        isAtBottom = true;

    logElem.innerText += "\n" + text;

    // Scroll
    if (isAtBottom) logElem.scrollTop = logElem.scrollHeight;
};

const calculateNewDimentions = dimentions => {
    let divisor = null;

    if (dimentions.width > MINIMUM_WIDTH) {
        for (let i = 1; dimentions.width / i > TARGET_WIDTH; i += 0.25)
            divisor = i;
    } else if (dimentions.height > MINIMUM_HEIGHT) {
        for (let i = 1; dimentions.height / i > TARGET_HEIGHT; i += 0.25)
            divisor = i;
    }

    if (divisor === null) return false;
    return {
        width: dimentions.width / divisor,
        height: dimentions.height / divisor
    };
};

let lowerBitrateCounter = 0;

const transcodeVideo = (inputPath, fileName) => {
    return new Promise(async (resolve, reject) => {
        // Replace file name extension
        const outputName = fileName.replace(/\.[^/.]+$/, "");

        const parentDir = path.join(inputPath, "..");
        const outputPath = path.join(parentDir, `${outputName}${SUFFIX}.mp4`);

        // DEBUG
        // log({ inputPath, outputPath });

        // Calculate best bitrate and resolution
        const duration = await getVideoDurationInSeconds(inputPath);
        let dimentions = await getDimensions(inputPath);
        const stats = fs.statSync(inputPath);
        // File size is in bytes, change it to kb
        const fileSize = stats.size / 1000;
        if (fileSize < 8000) return { transcoded: false, tries: 0 };

        const actualBitrate = fileSize / duration;
        const targetBitrate = TARGET_SIZE / duration;

        let newDimentions = null;
        let bitratesToAttempt = [];

        if (targetBitrate < actualBitrate / 3) {
            if (TRY_NOT_LOWERING_QUALITY >= lowerBitrateCounter) {
                for (let i = 1; i <= TRY_NOT_LOWERING_QUALITY; i++) {
                    const bitrateDiff = actualBitrate - targetBitrate;
                    const dividedBitrate = bitrateDiff / i + targetBitrate;
                    bitratesToAttempt.push(dividedBitrate);
                }
            }
            // DEBUG
            // log(bitratesToAttempt);
            // log("Target bitrate is less than a third: ", {
            //     targetBitrate,
            //     actualBitrate
            // });
            // If it's less than a third of its bitrate, try changing the resolution
            newDimentions = calculateNewDimentions(dimentions);
        }

        if (newDimentions) {
            // DEBUG
            // log("Changing resolution: ", { dimentions, newDimentions });
            dimentions = newDimentions;
        }

        log(
            "\n\n*****************" +
                `NOW TRANSCODING: ${outputName}\n` +
                `TRY_NOT_LOWERING_QUALITY: ${TRY_NOT_LOWERING_QUALITY} (${!!TRY_NOT_LOWERING_QUALITY})\n` +
                `bitratesToAttempt: ${bitratesToAttempt}\n` +
                `lowerBitrateCounter: ${lowerBitrateCounter}\n` +
                `targetBitrate: ${targetBitrate}\n` +
                `width: ${dimentions.width}\n` +
                `height: ${dimentions.height}\n` +
                `bitrate THAT WILL BE USED: ${
                    TRY_NOT_LOWERING_QUALITY &&
                    TRY_NOT_LOWERING_QUALITY > lowerBitrateCounter
                        ? bitratesToAttempt[lowerBitrateCounter]
                        : targetBitrate
                }` +
                "*****************\n"
        );

        hbjs.spawn({
            input: inputPath,
            output: outputPath,
            vb:
                TRY_NOT_LOWERING_QUALITY &&
                TRY_NOT_LOWERING_QUALITY > lowerBitrateCounter
                    ? bitratesToAttempt[lowerBitrateCounter]
                    : targetBitrate,
            "two-pass": true,
            turbo: true,
            height: dimentions.height,
            width: dimentions.width
        })
            .on("progress", progress => {
                const { percentComplete, eta } = progress;
                log(`Percent complete: ${percentComplete}, ETA: ${eta}`);
            })
            .on("error", err => reject(err))
            .on("end", () => {
                const newStats = fs.statSync(outputPath);
                const newFileSize = newStats.size / 1000;
                if (newFileSize > TARGET_SIZE) {
                    log(
                        `Oops, ${newFileSize}Kb was bigger than expected (${TARGET_SIZE}Kb)!`
                    );
                    lowerBitrateCounter++;
                    transcodeVideo(inputPath, fileName);
                } else {
                    const newStats = fs.statSync(outputPath);
                    const newFileSize = newStats.size / 1000;
                    log(`Transcoding successful! New size: ${newFileSize}Kb`);
                    resolve({ transcoded: true, tries: lowerBitrateCounter });
                }
            });
    });
};

const uploadVideo = async () => {
    const { files } = document.getElementById("videoInput");
    if (files.length <= 0) return log("No files selected!");
    for (file of files) {
        // DEBUG
        if (!fs.existsSync(file.path))
            return log(`File ${file.name} doesn't exist!`);

        try {
            const transcoded = await transcodeVideo(file.path, file.name);
            if (transcoded) log(`${file.name} transcoded!`);
            else log(`${file.name} was already under ${TARGET_SIZE / 1000}MB!`);
        } catch (err) {
            console.error(err);
        }
    }
    log(`${files.length} files selected!`);
};
