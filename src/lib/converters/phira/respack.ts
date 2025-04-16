export const getImageDimensions = async (input: File) => {
  // Validate input
  if (!input) {
    throw new Error('Input file is required.');
  }

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(input);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image.'));
    };

    img.src = url;
  });
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

  // Load image
  const { width, height } = await getImageDimensions(input);

  if (bounds[0] + bounds[1] >= height) {
    throw new Error('The sum of bounds must be less than the image height.');
  }

  // Calculate dimensions for each part
  const upperHeight = bounds[0];
  const middleHeight = height - bounds[0] - bounds[1];
  const lowerHeight = bounds[1];

  // Create image element from file
  const imgSrc = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(input);
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = imgSrc;
  });

  const results: { name: string; file: File }[] = [];

  // Helper function to extract part of the image
  const extractPart = (top: number, partHeight: number, name: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = partHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    ctx.drawImage(img, 0, top, width, partHeight, 0, 0, width, partHeight);

    return new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const extension = input.name.split('.').pop() || 'png';
          results.push({
            name: `Hold${name}${highlight ? 'HL' : ''}`,
            file: new File([blob], `${input.name}-${name}.${extension}`),
          });
        }
        resolve();
      });
    });
  };

  // Extract and save each part
  await extractPart(0, upperHeight, 'Tail');
  await extractPart(upperHeight, middleHeight, 'Body');
  await extractPart(height - lowerHeight, lowerHeight, 'Head');

  return results;
};
