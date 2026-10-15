# Vinyltron build helper (MIT, see repo LICENSE) for compiling the Python
# bindings of the pinned rpi-rgb-led-matrix commit (GPL-2.0), which predates
# that project's own pyproject.toml/setup.py.
from setuptools import setup, Extension
from Cython.Build import cythonize

lib_dir = '../../lib'
inc_dir = '../../include'

extensions = cythonize([
    Extension(
        'rgbmatrix.core',
        sources=['rgbmatrix/core.pyx', 'rgbmatrix/shims/pillow.c'],
        include_dirs=[inc_dir, 'rgbmatrix/shims'],
        libraries=['rgbmatrix'],
        library_dirs=[lib_dir],
        extra_link_args=['-Wl,-rpath,' + lib_dir],
        language='c++',
    ),
    Extension(
        'rgbmatrix.graphics',
        sources=['rgbmatrix/graphics.pyx'],
        include_dirs=[inc_dir],
        libraries=['rgbmatrix'],
        library_dirs=[lib_dir],
        extra_link_args=['-Wl,-rpath,' + lib_dir],
        language='c++',
    ),
])

setup(name='rgbmatrix', ext_modules=extensions)
