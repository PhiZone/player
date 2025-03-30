import sharp from 'sharp';

export const getImageDimensions = async (input: File) => {
  // Validate input
  if (!input) {
    throw new Error('Input file is required.');
  }

  // Load image metadata
  const buffer = await input.arrayBuffer();
  const metadata = await sharp(buffer).metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('Failed to retrieve image dimensions.');
  }

  return { width, height };
};

export const convertHoldAtlas = async (
  input: File,
  bounds: [number, number],
  highlight: boolean,
) => {
  // Validate input
  if (bounds[0] < 0 || bounds[1] < 0) {
    throw new Error('Bounds must be non-negative numbers.');
  }

  // Load image metadata
  const buffer = await input.arrayBuffer();
  const metadata = await sharp(buffer).metadata();
  const { width, height, format } = metadata;

  if (!width || !height) {
    throw new Error('Failed to retrieve image dimensions.');
  }

  if (bounds[0] + bounds[1] >= height) {
    throw new Error('The sum of bounds must be less than the image height.');
  }

  // Calculate dimensions for each part
  const upperHeight = bounds[1];
  const middleHeight = height - bounds[0] - bounds[1];
  const lowerHeight = bounds[0];

  const results: { name: string; file: File }[] = [];
  const createFile = (buffer: Buffer<ArrayBufferLike>, name: string) => {
    results.push({
      name: `Hold${name}${highlight ? 'HL' : ''}`,
      file: new File([buffer], `${input.name}-${name}.${format}`),
    });
  };

  // Extract and save each part
  sharp(buffer)
    .extract({ left: 0, top: 0, width, height: upperHeight })
    .toBuffer((err, buffer) => {
      if (err) throw err;
      createFile(buffer, 'Tail');
    });
  sharp(buffer)
    .extract({ left: 0, top: upperHeight, width, height: middleHeight })
    .toBuffer((err, buffer) => {
      if (err) throw err;
      createFile(buffer, 'Body');
    });
  sharp(buffer)
    .extract({ left: 0, top: height - lowerHeight, width, height: lowerHeight })
    .toBuffer((err, buffer) => {
      if (err) throw err;
      createFile(buffer, 'Head');
    });

  return results;
};
